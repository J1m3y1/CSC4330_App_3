// Committed on purpose - contains no secret. The real key is injected at
// build/run time via --dart-define so it never has to live in git.
//
// Local development:
//   1. Create env.json in the project root (gitignored):
//        { "TICKETMASTER_API_KEY": "your key" }
//   2. Run/test with: --dart-define-from-file=env.json
//      e.g. flutter run --dart-define-from-file=env.json
//
// Get a free Ticketmaster Discovery API key at:
// https://developer.ticketmaster.com/products-and-docs/apis/getting-started/

const String ticketmasterApiKey = String.fromEnvironment('TICKETMASTER_API_KEY');
