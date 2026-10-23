package luxe.sgj.ledger;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Edge to edge on every Android version (it is enforced from Android 15): the page
        // draws under the system bars and keeps its content clear of them with
        // env(safe-area-inset-*), which Capacitor's SystemBars keeps correct.
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
    }
}
