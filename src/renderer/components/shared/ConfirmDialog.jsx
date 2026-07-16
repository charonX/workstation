import { useTranslation } from "react-i18next";
import Modal from "./Modal.jsx";

/**
 * Shared confirmation dialog.
 * Props:
 *   - isOpen: boolean
 *   - title: string
 *   - message: string
 *   - confirmLabel?: string
 *   - cancelLabel?: string
 *   - onConfirm: () => void
 *   - onCancel: () => void
 */
export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel
}) {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      testid="confirm-dialog"
      size="sm"
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="confirm-cancel-button"
            onClick={onCancel}
          >
            {cancelLabel || t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            data-testid="confirm-ok-button"
            onClick={onConfirm}
          >
            {confirmLabel || t("common.confirm")}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}
