import { useTranslation } from "react-i18next";

/**
 * Shared Modal component.
 * Props:
 *   - isOpen: boolean — controls visibility
 *   - onClose: () => void — called when overlay clicked or close button pressed
 *   - title: string — modal title
 *   - children: ReactNode — modal body content
 *   - footer: ReactNode — optional footer content (buttons)
 *   - testid: string — data-testid for the modal container
 *   - size: "sm" | "md" | "lg" — modal width preset (default: md)
 */
export default function Modal({ isOpen, onClose, title, children, footer, testid, size = "md" }) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const sizeClass = {
    sm: "modal--sm",
    md: "modal--md",
    lg: "modal--lg",
  }[size];

  return (
    <div className="modal-overlay" onClick={onClose} data-testid={testid}>
      <div
        className={`modal ${sizeClass}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button
            className="icon-btn"
            onClick={onClose}
            type="button"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>

        <div className="modal-body">{children}</div>

        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
