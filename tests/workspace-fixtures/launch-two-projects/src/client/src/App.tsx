import React from 'react';

type TabKey = 'tab1' | 'tab2' | 'tab3';

const Tab3 = React.lazy(
  () =>
    new Promise<typeof import('./tabs/Tab3Lazy')>((resolve) => {
      setTimeout(() => resolve(import('./tabs/Tab3Lazy')), 2000);
    })
);

export function App() {
  const [active, setActive] = React.useState<TabKey>('tab1');

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <div role="tablist" aria-label="Tabs" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          role="tab"
          aria-selected={active === 'tab1'}
          data-testid="tab1"
          onClick={() => setActive('tab1')}
        >
          Tab 1
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={active === 'tab2'}
          data-testid="tab2"
          onClick={() => setActive('tab2')}
        >
          Tab 2
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={active === 'tab3'}
          data-testid="tab3"
          onClick={() => setActive('tab3')}
        >
          Tab 3
        </button>
      </div>

      <div role="tabpanel" style={{ padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
        {active === 'tab1' && <div>Hello from tab1 - default</div>}
        {active === 'tab2' && <div>Hello from tab2</div>}
        {active === 'tab3' && (
          <React.Suspense fallback={<div>loading...</div>}>
            <Tab3 />
          </React.Suspense>
        )}
      </div>
    </div>
  );
}

