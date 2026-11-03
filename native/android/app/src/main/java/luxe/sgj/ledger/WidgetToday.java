package luxe.sgj.ledger;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Ledger's "Today" widget, as on the iPhone (TodayWidget.swift): the day's progress, then
 * Morning Prime while it isn't done, today's exercise, and the Actions still to do in Flow
 * order; below, Communications as counts only. Read-only: an Action opens itself, the
 * Communications line opens Communications, anywhere else opens Today.
 */
public class WidgetToday extends AppWidgetProvider {

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) draw(ctx, mgr, id);
        WidgetKit.scheduleTick(ctx);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle options) {
        draw(ctx, mgr, id);
    }

    /** One line: its mark, title, what's beside it, and where a tap goes. */
    private static final class Row {
        int mark; Integer tint; boolean key; boolean quiet;
        String title; String trail; String link;
    }

    static void draw(Context ctx, AppWidgetManager mgr, int id) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_today);
        rv.setOnClickPendingIntent(R.id.w_root, WidgetKit.open(ctx, WidgetStore.TODAY_URL));
        rv.removeAllViews(R.id.w_rows);
        JSONObject all = WidgetStore.read(ctx), s = WidgetStore.today(all);
        if (s == null) {
            message(rv, ctx.getString(all == null ? R.string.widget_signed_out : R.string.widget_open_ledger));
            rv.setTextViewText(R.id.w_count, "");
            rv.setViewVisibility(R.id.w_progress, View.GONE);
            rv.setViewVisibility(R.id.w_more, View.GONE);
            rv.setViewVisibility(R.id.w_comms, View.GONE);
            mgr.updateAppWidget(id, rv);
            return;
        }
        int total = s.optInt("total", 0), done = s.optInt("done", 0);
        rv.setTextViewText(R.id.w_kicker, ("Today · " + s.optString("dayLabel", "")).toUpperCase());
        rv.setTextViewText(R.id.w_count, total > 0 ? done + " of " + total : "");
        rv.setViewVisibility(R.id.w_progress, total > 0 ? View.VISIBLE : View.GONE);
        rv.setProgressBar(R.id.w_progress, 100, total > 0 ? Math.round(100f * done / total) : 0, false);

        // Communications: counts only, never names ("2 need you · 1 due")
        String comms = commsText(s.optJSONObject("comms"));
        boolean showComms = comms != null;
        rv.setViewVisibility(R.id.w_comms, showComms ? View.VISIBLE : View.GONE);
        if (showComms) {
            JSONObject c = s.optJSONObject("comms");
            boolean needs = c != null && c.optInt("needs", 0) > 0;
            rv.setTextViewText(R.id.w_comms_text, "Comms · " + comms);
            rv.setTextColor(R.id.w_comms_text, WidgetKit.color(ctx, needs ? R.color.widget_gold : R.color.widget_text2));
            WidgetKit.tint(rv, R.id.w_comms_icon, WidgetKit.color(ctx, R.color.widget_text3));
            rv.setOnClickPendingIntent(R.id.w_comms, WidgetKit.open(ctx, WidgetStore.COMMS_URL));
        }

        List<Row> rows = rows(ctx, s);
        if (rows.isEmpty()) {
            message(rv, total == 0 ? "Nothing planned — open Ledger to plan today" : "All done");
            rv.setViewVisibility(R.id.w_more, View.GONE);
            mgr.updateAppWidget(id, rv);
            return;
        }
        rv.setViewVisibility(R.id.w_message, View.GONE);
        rv.setViewVisibility(R.id.w_rows, View.VISIBLE);
        // as many rows as fit: the header and progress take ~40dp, a row ~31dp
        int h = WidgetKit.heightDp(mgr, id, 180);
        int room = h - 32 - 40 - (showComms ? 22 : 0) - 16;
        int limit = Math.max(1, room / 31);
        if (rows.size() > limit) limit = Math.max(1, (room - 14) / 31);
        int shown = Math.min(limit, rows.size());
        for (int i = 0; i < shown; i++) {
            if (i > 0) rv.addView(R.id.w_rows, new RemoteViews(ctx.getPackageName(), R.layout.widget_rule));
            rv.addView(R.id.w_rows, rowView(ctx, rows.get(i)));
        }
        int more = rows.size() - shown;
        rv.setViewVisibility(R.id.w_more, more > 0 ? View.VISIBLE : View.GONE);
        if (more > 0) rv.setTextViewText(R.id.w_more, "+" + more + " more");
        mgr.updateAppWidget(id, rv);
    }

    private static void message(RemoteViews rv, String text) {
        rv.setViewVisibility(R.id.w_rows, View.GONE);
        rv.setViewVisibility(R.id.w_message, View.VISIBLE);
        rv.setTextViewText(R.id.w_message, text);
    }

    // what to list, in order: Morning Prime (until it's done), exercise, then open Actions
    private static List<Row> rows(Context ctx, JSONObject s) {
        List<Row> out = new ArrayList<>();
        JSONObject prime = s.optJSONObject("prime");
        if (prime != null) {
            Row r = new Row();
            r.mark = R.drawable.ic_widget_sunrise; r.tint = WidgetKit.color(ctx, R.color.widget_gold);
            r.title = "Morning Prime";
            String sh = WidgetStore.str(prime, "short");
            r.trail = sh != null ? sh : WidgetStore.str(prime, "label");
            r.link = WidgetStore.TODAY_URL;
            out.add(r);
        }
        JSONArray ex = WidgetStore.arr(s, "exercise");
        for (int i = 0; i < ex.length(); i++) {
            JSONObject e = ex.optJSONObject(i);
            if (e == null || WidgetStore.str(e, "title") == null) continue;
            Row r = new Row();
            boolean d = e.optBoolean("done", false);
            r.mark = d ? R.drawable.ic_widget_check : R.drawable.ic_widget_run;
            r.tint = d ? WidgetKit.color(ctx, R.color.widget_text3) : WidgetKit.category(ctx, "training");
            r.title = WidgetStore.str(e, "title");
            r.trail = d ? "Done" : "Planned";
            r.quiet = d;
            r.link = WidgetStore.TODAY_URL;
            out.add(r);
        }
        JSONArray items = WidgetStore.arr(s, "items");
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            if (it == null || !it.optBoolean("open", false) || WidgetStore.str(it, "title") == null) continue;
            Row r = new Row();
            r.mark = R.drawable.widget_dot; r.tint = WidgetKit.category(ctx, WidgetStore.str(it, "category"));
            r.key = it.optBoolean("key", false);
            r.title = WidgetStore.str(it, "title");
            r.trail = WidgetStore.str(it, "time");
            r.link = WidgetStore.safeLink(WidgetStore.str(it, "link"), WidgetStore.TODAY_URL);
            out.add(r);
        }
        return out;
    }

    private static RemoteViews rowView(Context ctx, Row r) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_row);
        v.setImageViewResource(R.id.r_mark, r.mark);
        if (r.tint != null) WidgetKit.tint(v, R.id.r_mark, r.tint);
        v.setViewVisibility(R.id.r_star, r.key ? View.VISIBLE : View.GONE);
        v.setTextViewText(R.id.r_title, r.title);
        v.setTextColor(R.id.r_title, WidgetKit.color(ctx, r.quiet ? R.color.widget_text2 : R.color.widget_text));
        v.setTextViewText(R.id.r_trail, r.trail == null ? "" : r.trail);
        v.setViewVisibility(R.id.r_trail, r.trail == null ? View.GONE : View.VISIBLE);
        v.setOnClickPendingIntent(R.id.r_root, WidgetKit.open(ctx, r.link));
        return v;
    }

    // "2 need you · 1 due" — counts only, as Today shows them; null when there's nothing
    static String commsText(JSONObject c) {
        if (c == null) return null;
        int needs = c.optInt("needs", 0), due = c.optInt("due", 0), waiting = c.optInt("waiting", 0);
        StringBuilder b = new StringBuilder();
        if (needs > 0) b.append(needs).append(needs == 1 ? " needs you" : " need you");
        if (due > 0) { if (b.length() > 0) b.append(" · "); b.append(due).append(" due"); }
        if (b.length() == 0 && waiting > 0) b.append(waiting).append(" waiting");
        return b.length() == 0 ? null : b.toString();
    }
}
