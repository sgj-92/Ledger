package luxe.sgj.ledger;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** The widgets' clock (WidgetKit.scheduleTick), and the phone's own time or date changing. */
public class WidgetTick extends BroadcastReceiver {
    static final String ACTION = "luxe.sgj.ledger.WIDGET_TICK";

    @Override
    public void onReceive(Context context, Intent intent) {
        WidgetKit.updateAll(context);
    }
}
