package luxe.sgj.ledger;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

/** What the three widgets share: links into Ledger, colours, sizes, redrawing, and the clock. */
final class WidgetKit {
    private WidgetKit() {}

    /** Open a Ledger link in the app (Capacitor hands it to the page as appUrlOpen). */
    static PendingIntent open(Context ctx, String link) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(link), ctx, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, link.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static int color(Context ctx, int res) {
        return ctx.getResources().getColor(res, ctx.getTheme());
    }

    /** A category's colour (QUICK_CAPTURE_CATEGORIES), as on the iPhone's widgets. */
    static int category(Context ctx, String key) {
        if (key == null) return color(ctx, R.color.widget_text3);
        switch (key) {
            case "mind": return color(ctx, R.color.widget_cat_mind);
            case "success": return color(ctx, R.color.widget_cat_success);
            case "work": return color(ctx, R.color.widget_cat_work);
            case "communicate": return color(ctx, R.color.widget_cat_communicate);
            case "family": return color(ctx, R.color.widget_cat_family);
            case "personal": return color(ctx, R.color.widget_cat_personal);
            case "training": return color(ctx, R.color.widget_cat_training);
            default: return color(ctx, R.color.widget_text3);
        }
    }

    /** The widget's height in dp as placed (portrait); a guess before the launcher says. */
    static int heightDp(AppWidgetManager mgr, int id, int fallback) {
        Bundle o = mgr.getAppWidgetOptions(id);
        int h = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        if (h <= 0 && o != null) h = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        return h > 0 ? h : fallback;
    }

    static int widthDp(AppWidgetManager mgr, int id, int fallback) {
        Bundle o = mgr.getAppWidgetOptions(id);
        int w = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        return w > 0 ? w : fallback;
    }

    /** Redraw every Ledger widget on the Home Screen, then set the next tick of the clock. */
    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : mgr.getAppWidgetIds(new ComponentName(ctx, WidgetToday.class))) WidgetToday.draw(ctx, mgr, id);
        for (int id : mgr.getAppWidgetIds(new ComponentName(ctx, WidgetFocus.class))) WidgetFocus.draw(ctx, mgr, id);
        for (int id : mgr.getAppWidgetIds(new ComponentName(ctx, WidgetFlow.class))) WidgetFlow.draw(ctx, mgr, id);
        scheduleTick(ctx);
    }

    /**
     * The clock: the widgets redraw by themselves when a focus timer ends ("Time's up"), at
     * each Flow step's start (the now line moves on), and at midnight (yesterday's day is no
     * longer shown as today's). One inexact alarm, always the next of these.
     */
    static void scheduleTick(Context ctx) {
        long now = System.currentTimeMillis(), next = nextMidnight(now);
        JSONObject snap = WidgetStore.today(WidgetStore.read(ctx));
        if (snap != null) {
            JSONObject focus = snap.optJSONObject("focus");
            long end = isoMillis(focus == null ? null : WidgetStore.str(focus, "endsAt"));
            if (end > now && end < next) next = end;
            JSONArray flow = WidgetStore.arr(snap, "flow");
            for (int i = 0; i < flow.length(); i++) {
                long t = clockToday(WidgetStore.str(flow.optJSONObject(i), "time"));
                if (t > now && t < next) next = t;
            }
        }
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent i = new Intent(ctx, WidgetTick.class).setAction(WidgetTick.ACTION);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.set(AlarmManager.RTC, next + 1000, pi);
    }

    static long nextMidnight(long now) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        c.add(Calendar.DAY_OF_YEAR, 1);
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    /** "HH:MM" today, as a time; -1 when it isn't one. */
    static long clockToday(String hhmm) {
        if (hhmm == null || !hhmm.matches("\\d{2}:\\d{2}")) return -1;
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, Integer.parseInt(hhmm.substring(0, 2)));
        c.set(Calendar.MINUTE, Integer.parseInt(hhmm.substring(3, 5)));
        c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    /** An ISO 8601 time as the web app writes it (toISOString: UTC, milliseconds); -1 if not. */
    static long isoMillis(String iso) {
        if (iso == null) return -1;
        String[] forms = { "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'" };
        for (String f : forms) {
            try {
                SimpleDateFormat p = new SimpleDateFormat(f, Locale.ROOT);
                p.setTimeZone(TimeZone.getTimeZone("UTC"));
                p.setLenient(false);
                Date d = p.parse(iso);
                if (d != null) return d.getTime();
            } catch (Exception ignored) { }
        }
        return -1;
    }

    /** A time of day in the phone's own style (14:05 or 2:05 pm). */
    static String clock(Context ctx, long millis) {
        return android.text.format.DateFormat.getTimeFormat(ctx).format(new Date(millis));
    }

    static void tint(RemoteViews rv, int viewId, int color) {
        rv.setInt(viewId, "setColorFilter", color);
    }
}
