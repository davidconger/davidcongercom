/*
 * Application Insights page tracking.
 *
 * Replaces the classic snippet, which loaded the 2015-era ai.0.js bundle from
 * az416426.vo.msecnd.net - a CDN host Microsoft has since put on a retirement
 * path. This loads the supported v3 SDK from js.monitor.azure.com instead.
 *
 * NOTE FOR MAINTENANCE: the connection string below carries only the
 * instrumentation key, which makes the SDK fall back to the default global
 * ingestion endpoint - the same endpoint the old snippet used, so behaviour is
 * unchanged. Microsoft now recommends the full connection string, which is
 * shown on the Application Insights resource overview blade in the Azure
 * portal and looks like:
 *
 *   InstrumentationKey=<key>;IngestionEndpoint=https://<region>.in.applicationinsights.azure.com/
 *
 * Pasting that value over CONNECTION_STRING is the only change needed.
 */
(function () {
  'use strict';

  var CONNECTION_STRING = 'InstrumentationKey=96bc4c06-f876-4056-a900-5c9d9f3eca99';
  var SDK_URL = 'https://js.monitor.azure.com/scripts/b/ai.3.gbl.min.js';

  function init() {
    try {
      var ns = window.Microsoft && window.Microsoft.ApplicationInsights;
      if (!ns || !ns.ApplicationInsights) return;

      var appInsights = new ns.ApplicationInsights({
        config: {
          connectionString: CONNECTION_STRING,
          disableExceptionTracking: false,
        },
      });

      appInsights.loadAppInsights();
      appInsights.trackPageView();

      window.appInsights = appInsights;
    } catch (e) {
      /* Analytics must never take the page down with it. */
      if (window.console) console.warn('Application Insights failed to initialise:', e);
    }
  }

  var script = document.createElement('script');
  script.src = SDK_URL;
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.onload = init;
  script.onerror = function () {
    if (window.console) console.warn('Application Insights SDK failed to load');
  };

  (document.head || document.documentElement).appendChild(script);
})();
