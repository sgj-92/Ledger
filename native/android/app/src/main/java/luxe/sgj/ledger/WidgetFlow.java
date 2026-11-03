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
 * Ledger's "Flow" widget, as on the iPhone (FlowWidget.swift): today's Flow in Shaun's order
 * — Actions, training and Reset Sprints — with their times, what's ticked, and the now line,
 * placed by Flow's own rule (index.html, renderFlow): after the last step that has started or
 * been ticked off, never past a timed step still to come. A long day shows the stretch around
 * now. An Action opens itself; anywhere else opens Today in Flow.
 */
public class WidgetFlow extends AppWidgetProvider {

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
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_flow);
        rv.setOnClickPendingIntent(R.id.w_root, WidgetKit.open(ctx, WidgetStore.FLOW_URL));
        rv.removeAllViews(R.id.w_rows);
        JSONObject all = WidgetStore.read(ctx), s = WidgetStore.today(all);
        JSONArray flow = s == null ? null : s.optJSONArray("flow");
        if (flow == null || flow.length() == 0) {
            String msg = all == null ? ctx.getString(R.string.widget_signed_out)
                : (s == null ? ctx.getString(R.string.widget_open_ledger) : "Nothing in today’s Flow yet");
            rv.setViewVisibility(R.id.w_rows, View.GONE);
            rv.setViewVisibility(R.id.w_message, View.VISIBLE);
            rv.setTextViewText(R.id.w_message, msg);
            rv.setViewVisibility(R.id.w_more, View.GONE);
            rv.setTextViewText(R.id.w_count, "");
            mgr.updateAppWidget(id, rv);
            return;
        }
        rv.setViewVisibility(R.id.w_rows, View.VISIBLE);
        rv.setViewVisibility(R.id.w_message, View.GONE);
        List<JSONObject> steps = new ArrayList<>();
        int done = 0;
        for (int i = 0; i < flow.length(); i++) {
            JSONObject st = flow.optJSONObject(i);
            if (st == null || WidgetStore.str(st, "title") == null) continue;
            steps.add(st);
            if (st.optBoolean("done", false)) done++;
        }
        rv.setTextViewText(R.id.w_kicker, ("Flow · " + s.optString("dayLabel", "")).toUpperCase());
        rv.setTextViewText(R.id.w_count, done + " of " + steps.size());

        // the rows, with the now line in its place (-1 stands for it)
        String now = WidgetStore.localHHMM();
        boolean timed = false;
        for (JSONObject st : steps) if (WidgetStore.str(st, "time") != null) { timed = true; break; }
        int anchor = -1;
        for (int i = 0; i < steps.size(); i++) if (!steps.get(i).optBoolean("done", false)) { anchor = i; break; }
        if (anchor < 0) anchor = Math.max(0, steps.size() - 1);
        List<Integer> rows = new ArrayList<>();
        for (int i = 0; i < steps.size(); i++) rows.add(i);
        if (timed) {
            int limitIndex = steps.size();
            for (int i = 0; i < steps.size(); i++) {
                String t = WidgetStore.str(steps.get(i), "time");
                if (t != null && t.compareTo(now) > 0) { limitIndex = i; break; }
            }
            int behind = -1;
            for (int i = 0; i < limitIndex; i++) {
                String t = WidgetStore.str(steps.get(i), "time");
                boolean started = t != null && t.compareTo(now) <= 0;
                if (started || steps.get(i).optBoolean("done", false)) behind = i;
            }
            anchor = behind + 1;
            rows.add(anchor, -1);
        }
        // as many rows as fit, from just before now
        int h = WidgetKit.heightDp(mgr, id, 250);
        int limit = Math.max(2, (h - 32 - 26 - 16) / 28);
        int start = 0;
        if (rows.size() > limit) start = Math.min(Math.max(0, anchor - 1), rows.size() - limit);
        int end = Math.min(rows.size(), start + limit);
        for (int r = start; r < end; r++) {
            int i = rows.get(r);
            if (i < 0) rv.addView(R.id.w_rows, nowView(ctx, now));
            else rv.addView(R.id.w_rows, stepView(ctx, steps.get(i)));
        }
        int later = 0;
        for (int r = end; r < rows.size(); r++) if (rows.get(r) >= 0) later++;
        rv.setViewVisibility(R.id.w_more, later > 0 ? View.VISIBLE : View.GONE);
        if (later > 0) rv.setTextViewText(R.id.w_more, "+" + later + " later");
        mgr.updateAppWidget(id, rv);
    }

    private static RemoteViews nowView(Context ctx, String now) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_flow_now);
        v.setTextViewText(R.id.n_time, now);
        return v;
    }

    private static RemoteViews stepView(Context ctx, JSONObject st) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_flow_row);
        boolean done = st.optBoolean("done", false);
        String kind = st.optString("kind", "action"), time = WidgetStore.str(st, "time");
        v.setTextViewText(R.id.r_time, time == null ? "" : time);
        if (done) {
            v.setImageViewResource(R.id.r_mark, R.drawable.ic_widget_check);
            WidgetKit.tint(v, R.id.r_mark, WidgetKit.color(ctx, R.color.widget_text3));
        } else if ("training".equals(kind)) {
            v.setImageViewResource(R.id.r_mark, R.drawable.ic_widget_run);
            WidgetKit.tint(v, R.id.r_mark, WidgetKit.category(ctx, "training"));
        } else {
            v.setImageViewResource(R.id.r_mark, R.drawable.widget_dot);
            WidgetKit.tint(v, R.id.r_mark, "sprint".equals(kind) ? WidgetKit.color(ctx, R.color.widget_gold) : WidgetKit.category(ctx, WidgetStore.str(st, "category")));
        }
        v.setViewVisibility(R.id.r_star, st.optBoolean("key", false) && !done ? View.VISIBLE : View.GONE);
        v.setTextViewText(R.id.r_title, WidgetStore.str(st, "title"));
        v.setTextColor(R.id.r_title, WidgetKit.color(ctx, done ? R.color.widget_text3 : R.color.widget_text));
        // an Action opens itself; training and sprints open Flow
        String link = "action".equals(kind) ? WidgetStore.safeLink(WidgetStore.str(st, "link"), WidgetStore.FLOW_URL) : WidgetStore.FLOW_URL;
        v.setOnClickPendingIntent(R.id.r_root, WidgetKit.open(ctx, link));
        return v;
    }
}
