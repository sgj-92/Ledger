package luxe.sgj.ledger;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.Calendar;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Where Ledger's widgets get their day: the Today snapshot the web app builds by Ledger's own
 * rules (index.html, buildWidgetSnapshot; docs/NATIVE_MIGRATION.md §4.1) and hands over through
 * LedgerWidget.publish. Kept in the app's private storage, read by the widgets, cleared on
 * sign-out. Nothing here interprets Ledger data beyond checking its shape: the iPhone's
 * widgets read the same snapshot (native/ios/App/Shared/LedgerShared.swift).
 */
final class WidgetStore {
    static final int MAX_BYTES = 64 * 1024;
    static final String SCHEME = "luxe.sgj.ledger";
    static final String TODAY_URL = SCHEME + "://open?view=today";
    static final String FLOW_URL = SCHEME + "://open?view=today&mode=flow";
    static final String COMMS_URL = SCHEME + "://open?view=comms";
    static final String FOCUS_URL = SCHEME + "://open?view=focus";

    private static final String PREFS = "ledger_widget";
    private static final String KEY = "snapshot";

    private WidgetStore() {}

    /** The snapshot as JSON, if it is one: a version, a day (YYYY-MM-DD) and its Actions. */
    static JSONObject parse(String json) {
        if (json == null || json.length() > MAX_BYTES) return null;
        try {
            JSONObject o = new JSONObject(json);
            if (o.optInt("v", 0) < 1) return null;
            if (!o.optString("date", "").matches("\\d{4}-\\d{2}-\\d{2}")) return null;
            if (o.optJSONArray("items") == null) return null;
            return o;
        } catch (JSONException e) {
            return null;
        }
    }

    static boolean write(Context ctx, String json) {
        if (parse(json) == null) return false;
        return prefs(ctx).edit().putString(KEY, json).commit();
    }

    static void clear(Context ctx) {
        prefs(ctx).edit().remove(KEY).commit();
    }

    /** The last snapshot, or null: signed out, or never opened. */
    static JSONObject read(Context ctx) {
        return parse(prefs(ctx).getString(KEY, null));
    }

    /** The snapshot only when it describes today on this phone (the web app writes local dates). */
    static JSONObject today(JSONObject snap) {
        return snap != null && localDate().equals(snap.optString("date")) ? snap : null;
    }

    static String localDate() {
        Calendar c = Calendar.getInstance();
        return String.format(Locale.ROOT, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    static String localHHMM() {
        Calendar c = Calendar.getInstance();
        return String.format(Locale.ROOT, "%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE));
    }

    /** A JSON string field, or null when it is missing, null or empty. */
    static String str(JSONObject o, String key) {
        if (o == null || !o.has(key) || o.isNull(key)) return null;
        String s = o.optString(key, null);
        return s == null || s.isEmpty() ? null : s;
    }

    static JSONArray arr(JSONObject o, String key) {
        JSONArray a = o == null ? null : o.optJSONArray(key);
        return a == null ? new JSONArray() : a;
    }

    /** Only Ledger's own links open from a widget; anything else opens Today. */
    static String safeLink(String link, String fallback) {
        return link != null && link.startsWith(SCHEME + "://open") ? link : fallback;
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
