import { BENEFITS_CONFIG } from '../config/benefits';

export function MarketingBenefits() {
  return (
    <div className="marketing-benefits">
      {/* Static text: section heading */}
      <h2 className="benefits-title">Exclusive Benefits</h2>
      {/* Static text: subtitle */}
      <p className="benefits-subtitle">As a Gold member, you enjoy:</p>

      {/* Config-driven: rendered by iterating BENEFITS_CONFIG */}
      <ul className="benefits-list">
        {BENEFITS_CONFIG.map((benefit) => (
          <li
            key={benefit.id}
            className={`benefit-item${benefit.isPremium ? ' benefit-item--premium' : ''}`}
          >
            <span className="benefit-icon">{benefit.icon}</span>
            <div className="benefit-content">
              {/* Config-driven: title from config object */}
              <div className="benefit-title">{benefit.title}</div>
              {/* Config-driven: description from config object */}
              <div className="benefit-description">{benefit.description}</div>
              {/* Conditional rendering: premium badge only for premium items */}
              {benefit.isPremium && <span className="premium-badge">Premium</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
