/**
 * Web Vitals monitoring using native PerformanceObserver
 * No external dependencies
 */

interface VitalMetric {
  name: string;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
}

const isDev = import.meta.env.DEV;

function report(metric: VitalMetric) {
  if (isDev) {
    const color = metric.rating === 'good' ? '🟢' : metric.rating === 'needs-improvement' ? '🟡' : '🔴';
    console.log(`${color} [WebVitals] ${metric.name}: ${metric.value.toFixed(1)}ms (${metric.rating})`);
  }
}

function rateLCP(value: number): VitalMetric['rating'] {
  if (value <= 2500) return 'good';
  if (value <= 4000) return 'needs-improvement';
  return 'poor';
}

function rateINP(value: number): VitalMetric['rating'] {
  if (value <= 200) return 'good';
  if (value <= 500) return 'needs-improvement';
  return 'poor';
}

function rateCLS(value: number): VitalMetric['rating'] {
  if (value <= 0.1) return 'good';
  if (value <= 0.25) return 'needs-improvement';
  return 'poor';
}

export function initWebVitals() {
  if (typeof PerformanceObserver === 'undefined') return;

  // LCP (Largest Contentful Paint)
  try {
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lastEntry = entries[entries.length - 1];
      if (lastEntry) {
        report({
          name: 'LCP',
          value: lastEntry.startTime,
          rating: rateLCP(lastEntry.startTime),
        });
      }
    });
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* Not supported */ }

  // FID / INP (First Input Delay / Interaction to Next Paint)
  try {
    const fidObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEventTiming;
        if (e.processingStart) {
          const delay = e.processingStart - e.startTime;
          report({
            name: 'INP',
            value: delay,
            rating: rateINP(delay),
          });
        }
      }
    });
    fidObserver.observe({ type: 'first-input', buffered: true });
  } catch { /* Not supported */ }

  // CLS (Cumulative Layout Shift)
  try {
    let clsValue = 0;
    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!(entry as any).hadRecentInput) {
          clsValue += (entry as any).value;
        }
      }
      report({
        name: 'CLS',
        value: clsValue,
        rating: rateCLS(clsValue),
      });
    });
    clsObserver.observe({ type: 'layout-shift', buffered: true });
  } catch { /* Not supported */ }

  // TTFB (Time to First Byte)
  try {
    const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (navEntries.length > 0) {
      const ttfb = navEntries[0].responseStart;
      report({
        name: 'TTFB',
        value: ttfb,
        rating: ttfb <= 800 ? 'good' : ttfb <= 1800 ? 'needs-improvement' : 'poor',
      });
    }
  } catch { /* Not supported */ }
}
