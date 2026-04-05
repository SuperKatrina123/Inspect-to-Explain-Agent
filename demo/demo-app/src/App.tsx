import { useEffect } from 'react';
import { UserProfileCard } from './components/UserProfileCard';
import { OrderSummary } from './components/OrderSummary';
import { MarketingBenefits } from './components/MarketingBenefits';
import { mockUser, mockOrder } from './data/mockData';
import { initInspectBridge } from './inspect/inspectBridge';
import './App.css';

function App() {
  // Register cross-frame inspect bridge on first mount
  useEffect(() => { initInspectBridge(); }, []);

  return (
    <div className="demo-app">
      <header className="demo-header">
        <h1>Demo E-Commerce Page</h1>
        <p className="demo-subtitle">Enable Inspect Mode in the parent app, then click any element</p>
      </header>
      <main className="demo-main">
        <div className="demo-grid">
          <UserProfileCard user={mockUser} />
          <OrderSummary order={mockOrder} />
          <MarketingBenefits />
        </div>
      </main>
    </div>
  );
}

export default App;
