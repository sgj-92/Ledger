package luxe.sgj.ledger;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONObject;

/**
 * Ledger's "Focus" widget, as on the iPhone (FocusWidget.swift): the Current Focus and
 * nothing else; with a timer, the time left counting down on the Home Screen, then "Time's
 * up". Tapping it opens that Action or sprint; with no focus, the picker to choose one.
 */
public class WidgetFocus extends AppWidgetProvider {

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) draw(ctx, mgr, id);
        WidgetKit.scheduleTick(ctx);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle options) {
        draw(ctx, mgr, id);
    }

    static void draw(Context ctx, AppWidgetManager mgr, int id) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_focus);
        JSONObject all = WidgetStore.read(ctx), s = WidgetStore.today(all);
        JSONObject f = s == null ? null : s.optJSONObject("focus");
        String title = f == null ? null : WidgetStore.str(f, "title");
        if (title == null) {
            rv.setTextViewText(R.id.w_kicker, "FOCUS");
            rv.setViewVisibility(R.id.f_timer_row, View.GONE);
            if (s == null) {
                rv.setTextViewText(R.id.f_title, all == null ? "Sign in to Ledger" : "Open Ledger");
                rv.setTextViewText(R.id.f_context, all == null ? "Your focus shows here" : "to see today’s focus");
                rv.setOnClickPendingIntent(R.id.w_root, WidgetKit.open(ctx, WidgetStore.TODAY_URL));
            } else {
                rv.setTextViewText(R.id.f_title, "No focus set");
                rv.setTextViewText(R.id.f_context, "Tap to choose what to focus on");
                rv.setOnClickPendingIntent(R.id.w_root, WidgetKit.open(ctx, WidgetStore.FOCUS_URL));
            }
            mgr.updateAppWidget(id, rv);
            return;
        }
        rv.setTextViewText(R.id.w_kicker, "FOCUS NOW");
        rv.setTextViewText(R.id.f_title, title);
        rv.setOnClickPendingIntent(R.id.w_root, WidgetKit.open(ctx, WidgetStore.safeLink(WidgetStore.str(f, "link"), WidgetStore.TODAY_URL)));
        // a focus timer: the time left, counting down by itself, then "Time's up"
        long now = System.currentTimeMillis(), end = WidgetKit.isoMillis(WidgetStore.str(f, "endsAt"));
        WidgetKit.tint(rv, R.id.f_timer_icon, WidgetKit.color(ctx, R.color.widget_gold));
        if (end > 0) {
            rv.setViewVisibility(R.id.f_timer_row, View.VISIBLE);
            boolean running = end > now;
            rv.setViewVisibility(R.id.f_timer, running ? View.VISIBLE : View.GONE);
            rv.setViewVisibility(R.id.f_timesup, running ? View.GONE : View.VISIBLE);
            if (running) {
                rv.setChronometer(R.id.f_timer, SystemClock.elapsedRealtime() + (end - now), null, true);
                rv.setChronometerCountDown(R.id.f_timer, true);
            }
        } else {
            rv.setViewVisibility(R.id.f_timer_row, View.GONE);
        }
        // "Action · 10:00 · since 9:40"
        String ctxText = WidgetStore.str(f, "context");
        long set = WidgetKit.isoMillis(WidgetStore.str(f, "setAt"));
        String since = set > 0 ? "since " + WidgetKit.clock(ctx, set) : null;
        String line = ctxText == null ? (since == null ? "" : "S" + since.substring(1)) : (since == null ? ctxText : ctxText + " · " + since);
        rv.setTextViewText(R.id.f_context, line);
        rv.setViewVisibility(R.id.f_context, line.isEmpty() ? View.GONE : View.VISIBLE);
        // a short widget keeps the title to two lines
        rv.setInt(R.id.f_title, "setMaxLines", WidgetKit.heightDp(mgr, id, 160) < 140 ? 2 : 4);
        mgr.updateAppWidget(id, rv);
    }
}
