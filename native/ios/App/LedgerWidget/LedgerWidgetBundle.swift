import WidgetKit
import SwiftUI

@main
struct LedgerWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        FocusWidget()
        FlowWidget()
        FocusLiveActivity()     // the focus timer on the Lock Screen and in the Dynamic Island
    }
}
