'use strict';

// Azure App Service detects Node applications from the repository root.
// The application itself lives in backend/, while its static pages live here.
require('./backend/server').start();
