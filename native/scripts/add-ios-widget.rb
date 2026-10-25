# Adds Ledger's widget extension (LedgerWidget) and its plumbing to the iOS project, the way
# Xcode's File → New → Target → Widget Extension would. Run once; it refuses to run twice.
#
#   gem install xcodeproj
#   ruby native/scripts/add-ios-widget.rb
#
# App target: + LedgerWidgetPlugin.swift, LedgerBridgeViewController.swift, Shared/
#   LedgerShared.swift, App.entitlements (App Group), and embeds the extension.
# LedgerWidget target (iOS 17+): LedgerWidgetBundle.swift, TodayWidget.swift, Shared/
#   LedgerShared.swift, Info.plist, LedgerWidget.entitlements (the same App Group).
require 'xcodeproj'

root = File.expand_path('../ios/App', __dir__)
project = Xcodeproj::Project.open(File.join(root, 'App.xcodeproj'))
abort 'LedgerWidget is already in the project' if project.targets.any? { |t| t.name == 'LedgerWidget' }
app = project.targets.find { |t| t.name == 'App' } or abort 'no App target'
main = project.main_group

# --- the app: the plugin, its view controller, the shared model, the App Group ---
app_group = main.children.find { |g| g.respond_to?(:path) && g.path == 'App' } or abort 'no App group'
%w[LedgerBridgeViewController.swift LedgerWidgetPlugin.swift].each do |f|
  app.source_build_phase.add_file_reference(app_group.new_reference(f))
end
app_group.new_reference('App.entitlements')
shared = main.new_group('Shared', 'Shared')
shared_ref = shared.new_reference('LedgerShared.swift')
app.source_build_phase.add_file_reference(shared_ref)
app.build_configurations.each { |c| c.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'App/App.entitlements' }

# --- the widget extension ---
widget = project.new_target(:app_extension, 'LedgerWidget', :ios, '17.0', project.products_group, :swift)
wgroup = main.new_group('LedgerWidget', 'LedgerWidget')
%w[LedgerWidgetBundle.swift TodayWidget.swift].each do |f|
  widget.source_build_phase.add_file_reference(wgroup.new_reference(f))
end
wgroup.new_reference('Info.plist')
wgroup.new_reference('LedgerWidget.entitlements')
widget.source_build_phase.add_file_reference(shared_ref)
widget.add_system_frameworks(%w[WidgetKit SwiftUI])
widget.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'luxe.sgj.ledger.LedgerWidget'
  s['INFOPLIST_FILE'] = 'LedgerWidget/Info.plist'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['CODE_SIGN_ENTITLEMENTS'] = 'LedgerWidget/LedgerWidget.entitlements'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['SWIFT_VERSION'] = '5.0'
  s['MARKETING_VERSION'] = '1.0'
  s['CURRENT_PROJECT_VERSION'] = '1'
  s['SKIP_INSTALL'] = 'YES'
  s['SWIFT_EMIT_LOC_STRINGS'] = 'YES'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
end

# --- the app carries the extension ---
embed = app.new_copy_files_build_phase('Embed Foundation Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
embed.add_file_reference(widget.product_reference).settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
app.add_dependency(widget)

project.save
puts 'LedgerWidget added'
