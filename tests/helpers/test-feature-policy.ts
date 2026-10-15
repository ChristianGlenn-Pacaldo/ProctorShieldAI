// Retained Arena design regressions explicitly opt into future reactivation.
// Dedicated defense tests remove the flag and exercise the disabled defaults.
// This preload is used only by npm test, never by next dev/build/start.
process.env.POWER_ARENA_ENABLED ??= "true";
