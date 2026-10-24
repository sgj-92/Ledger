package luxe.sgj.ledger;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Capacitor first: it switches from the launch theme to AppTheme.NoActionBar and
        // builds the window. Asking for edge to edge before that made Android build the
        // window with the launch theme — and give it an action bar titled "Ledger".
        super.onCreate(savedInstanceState);
        // Edge to edge on every Android version (it is enforced from Android 15): the page
        // draws under the system bars and keeps its content clear of them with
        // env(safe-area-inset-*), which Capacitor's SystemBars keeps correct.
        EdgeToEdge.enable(this);
    }
}
