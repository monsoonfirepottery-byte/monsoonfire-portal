(function () {
  var gtagScript = document.createElement('script');
  gtagScript.async = true;
  gtagScript.src = 'https://www.googletagmanager.com/gtag/js?id=G-ZJQ30LHFKH';
  document.head.appendChild(gtagScript);

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  gtag('js', new Date());
  gtag('config', 'G-ZJQ30LHFKH');

  function loadScript(done) {
    var head = document.getElementsByTagName('head')[0];
    var script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://tracker.metricool.com/resources/be.js';
    script.onreadystatechange = done;
    script.onload = done;
    head.appendChild(script);
  }

  loadScript(function () {
    if (typeof window.beTracker !== 'undefined' && typeof window.beTracker.t === 'function') {
      window.beTracker.t({ hash: '66cdb7f9a3fce2c22ac2edbdc56cb820' });
    }
  });
})();
