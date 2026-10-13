#import <Cocoa/Cocoa.h>
#import <Sparkle/Sparkle.h>
#include <node_api.h>

// Loaded only by Electron's main process, on the Cocoa main thread.
static SPUStandardUpdaterController *controller;
static BOOL busy = NO;

@interface MuseUpdaterDelegate : NSObject <SPUUpdaterDelegate>
@end
@implementation MuseUpdaterDelegate
- (BOOL)updaterShouldRelaunchApplication:(SPUUpdater *)updater {
  if (!busy) return YES;
  NSAlert *alert = [[NSAlert alloc] init];
  alert.messageText = @"Muse is still working";
  alert.informativeText = @"Finish or stop active conversations before installing an update. Check for updates again when you are ready.";
  [alert addButtonWithTitle:@"Keep working"];
  [alert runModal];
  return NO;
}
@end
static MuseUpdaterDelegate *delegate;

static napi_value fail(napi_env env, const char *message) {
  napi_throw_error(env, nullptr, message);
  return nullptr;
}

static bool ready(napi_env env) {
  if (![NSThread isMainThread] || !controller) {
    fail(env, "Sparkle must be initialized on the application main thread.");
    return false;
  }
  return true;
}

static napi_value status(napi_env env, napi_callback_info info) {
  if (!ready(env)) return nullptr;
  napi_value result, value;
  napi_create_object(env, &result);
  napi_get_boolean(env, controller.updater.canCheckForUpdates, &value);
  napi_set_named_property(env, result, "canCheck", value);
  napi_get_boolean(env, controller.updater.automaticallyChecksForUpdates, &value);
  napi_set_named_property(env, result, "automaticChecks", value);
  return result;
}

static napi_value initialize(napi_env env, napi_callback_info info) {
  if (![NSThread isMainThread]) return fail(env, "Sparkle requires the application main thread.");
  if (!controller) {
    delegate = [[MuseUpdaterDelegate alloc] init];
    controller = [[SPUStandardUpdaterController alloc] initWithStartingUpdater:NO updaterDelegate:delegate userDriverDelegate:nil];
    NSError *error = nil;
    if (![controller.updater startUpdater:&error]) {
      controller = nil;
      return fail(env, error.localizedDescription.UTF8String);
    }
  }
  return status(env, info);
}

static napi_value check(napi_env env, napi_callback_info info) {
  if (!ready(env)) return nullptr;
  if (!controller.updater.canCheckForUpdates) return fail(env, "An update check is already in progress.");
  [controller checkForUpdates:nil];
  return status(env, info);
}

static napi_value setBoolean(napi_env env, napi_callback_info info) {
  if (!ready(env)) return nullptr;
  size_t argc = 1;
  napi_value argv[1];
  void *operation;
  napi_get_cb_info(env, info, &argc, argv, nullptr, &operation);
  bool value;
  if (argc != 1 || napi_get_value_bool(env, argv[0], &value) != napi_ok) {
    return fail(env, "Expected a boolean.");
  }
  if (operation) busy = value;
  else controller.updater.automaticallyChecksForUpdates = value;
  return status(env, info);
}

static napi_value module(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"initialize", nullptr, initialize, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"status", nullptr, status, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"check", nullptr, check, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setAutomaticChecks", nullptr, setBoolean, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setBusy", nullptr, setBoolean, nullptr, nullptr, nullptr, napi_default, (void *)1},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}
NAPI_MODULE(sparkle, module)
