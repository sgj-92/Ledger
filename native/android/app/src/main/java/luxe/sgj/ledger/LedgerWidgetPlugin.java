package luxe.sgj.ledger;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The web app's way to Android's widgets and focus countdown — the same plugin, by name and
 * methods, as the iPhone's (native/ios/App/App/LedgerWidgetPlugin.swift):
 * - publish / clear: the Today snapshot Ledger builds (by its own rules) for the widgets;
 *   only its shape and size are checked here;
 * - focusActivity / endFocusActivity: the focus timer counting down in the notification shade
 *   and on the lock screen (on Android 16, a Live Update in the status bar), as the iPhone's
 *   Live Activity; Android draws the countdown itself;
 * - keepAwake: the full-screen focus view keeps the screen on while it's open.
 */
@CapacitorPlugin(name = "LedgerWidget")
public class LedgerWidgetPlugin extends Plugin {
    static final String FOCUS_CHANNEL = "focus-live";
    static final int FOCUS_NOTIFICATION = 7120;

    @PluginMethod
    public void publish(PluginCall call) {
        String json = call.getString("snapshot");
        if (WidgetStore.parse(json) == null) { call.reject("Not a Today snapshot"); return; }
        if (!WidgetStore.write(getContext(), json)) { call.reject("The snapshot couldn't be kept"); return; }
        WidgetKit.updateAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        WidgetStore.clear(getContext());
        WidgetKit.updateAll(getContext());
        cancelFocus();
        call.resolve();
    }

    /**
     * Start the countdown, or update the one showing (a new length, +5 min, the next
     * exercise): there is only ever one. Resolves { shown: false } when Ledger can't post
     * notifications on this phone.
     */
    @PluginMethod
    public void focusActivity(PluginCall call) {
        String title = call.getString("title");
        long endsAt = WidgetKit.isoMillis(call.getString("endsAt"));
        if (title == null || title.isEmpty() || endsAt <= 0) { call.reject("A title and an end time"); return; }
        Context ctx = getContext();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        long now = System.currentTimeMillis();
        if (nm == null || !nm.areNotificationsEnabled() || endsAt <= now) {
            JSObject r = new JSObject();
            r.put("shown", false);
            call.resolve(r);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(FOCUS_CHANNEL, ctx.getString(R.string.focus_channel_name), NotificationManager.IMPORTANCE_LOW);
            ch.setDescription(ctx.getString(R.string.focus_channel_desc));
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        String context = call.getString("context");
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(ctx, FOCUS_CHANNEL)
            : new Notification.Builder(ctx);
        b.setSmallIcon(R.drawable.ic_stat_ledger)
            .setColor(WidgetKit.color(ctx, R.color.widget_gold))
            .setContentTitle(title.length() > 200 ? title.substring(0, 200) : title)
            .setContentText(context == null || context.isEmpty() ? "Focus" : (context.length() > 120 ? context.substring(0, 120) : context))
            .setWhen(endsAt)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setContentIntent(WidgetKit.open(ctx, WidgetStore.TODAY_URL));
        // gone when time's up: the "Time's up" alert (Local Notifications) takes over
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) b.setTimeoutAfter(endsAt - now);
        // Android 16 (36.1 on): ask for it to be a Live Update, the countdown chip in the status
        // bar. Notification.EXTRA_REQUEST_PROMOTED_ONGOING, by its value: compileSdk 36 doesn't
        // have it yet, and earlier Android simply ignores the extra.
        Bundle promote = new Bundle();
        promote.putBoolean("android.requestPromotedOngoing", true);
        b.addExtras(promote);
        nm.notify(FOCUS_NOTIFICATION, b.build());
        JSObject r = new JSObject();
        r.put("shown", true);
        call.resolve(r);
    }

    /** The timer stopped, the focus done or cleared: take it away. */
    @PluginMethod
    public void endFocusActivity(PluginCall call) {
        cancelFocus();
        call.resolve();
    }

    private void cancelFocus() {
        NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(FOCUS_NOTIFICATION);
    }

    /** The full-screen focus view keeps the screen on while it's open. */
    @PluginMethod
    public void keepAwake(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        Activity a = getActivity();
        if (a == null) { call.resolve(); return; }
        a.runOnUiThread(() -> {
            if (on) a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }
}
