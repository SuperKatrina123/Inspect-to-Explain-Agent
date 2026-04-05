import { ElementContext } from '../types';

interface Props { context: ElementContext | null }

export function SelectedElementPanel({ context }: Props) {
  if (!context) {
    return (
      <div className="panel">
        <h3 className="panel-title">📌 Selected Element</h3>
        <p className="panel-empty">Enable inspect mode and click an element in the demo</p>
      </div>
    );
  }

  const { selectedElement: el, ancestors, nearbyTexts } = context;

  return (
    <div className="panel">
      <h3 className="panel-title">📌 Selected Element</h3>
      <div className="info-grid">
        <Row label="Tag"      value={<code>{el.tag}</code>} />
        <Row label="Text"     value={el.text || '(empty)'} />
        <Row label="Class"    value={<code className="truncate-val">{el.className || '(none)'}</code>} />
        <Row label="ID"       value={<code>{el.id || '(none)'}</code>} />
        <Row label="Selector" value={<code className="truncate-val">{el.selector}</code>} />
        <Row label="XPath"    value={<code className="truncate-val">{el.xpath}</code>} />
      </div>

      {ancestors.length > 0 && (
        <Section title={`Ancestors (${ancestors.length})`}>
          {ancestors.map((a, i) => (
            <div key={i} className="chip">
              &lt;{a.tag}{a.id ? ` #${a.id}` : ''}{a.className ? ` .${a.className.split(' ')[0]}` : ''}&gt;
            </div>
          ))}
        </Section>
      )}

      {nearbyTexts.length > 0 && (
        <Section title="Nearby Texts">
          {nearbyTexts.slice(0, 5).map((t, i) => (
            <div key={i} className="nearby-text">"{t}"</div>
          ))}
        </Section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-value">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="info-section">
      <div className="section-label">{title}</div>
      <div className="section-body">{children}</div>
    </div>
  );
}
