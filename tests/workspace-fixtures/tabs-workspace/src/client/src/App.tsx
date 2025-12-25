import React, { useEffect, useMemo, useState } from 'react';

type TabId = 'tab1' | 'tab2' | 'tab3';

export function App() {
  const [active, setActive] = useState<TabId>('tab1');
  const [tab3Loaded, setTab3Loaded] = useState(false);

  useEffect(() => {
    if (active !== 'tab3') return;
    setTab3Loaded(false);
    const t = setTimeout(() => setTab3Loaded(true), 2000);
    return () => clearTimeout(t);
  }, [active]);

  const content = useMemo(() => {
    if (active === 'tab1') return 'Hello from tab1 - default';
    if (active === 'tab2') return 'Hello from tab2';
    if (active === 'tab3') return tab3Loaded ? 'Hello from tab3 - lazy' : 'loading...';
    // Exhaustive fallback.
    return '';
  }, [active, tab3Loaded]);

  return (
    <div>
      <div className="tabs" role="tablist" aria-label="Tabs">
        <button
          type="button"
          role="tab"
          aria-selected={active === 'tab1'}
          onClick={() => setActive('tab1')}
          data-testid="tab-1"
        >
          Tab 1
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={active === 'tab2'}
          onClick={() => setActive('tab2')}
          data-testid="tab-2"
        >
          Tab 2
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={active === 'tab3'}
          onClick={() => setActive('tab3')}
          data-testid="tab-3"
        >
          Tab 3
        </button>
      </div>

      <div className="panel" role="tabpanel" data-testid="tab-content">
        {content}
      </div>
    </div>
  );
}

