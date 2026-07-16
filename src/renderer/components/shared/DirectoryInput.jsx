import { useTranslation } from "react-i18next";

export default function DirectoryInput({
  id,
  value,
  onChange,
  placeholder,
  pickerTitle,
  "data-testid": testid,
}) {
  const { t } = useTranslation();

  async function handleSelect() {
    if (!window.opc?.selectDirectory) return;
    try {
      const selected = await window.opc.selectDirectory(
        pickerTitle,
        value || undefined
      );
      if (selected) {
        onChange(selected);
      }
    } catch {
      // Ignore picker errors (e.g., user cancellation or unsupported env).
    }
  }

  return (
    <div className="directory-input">
      <input
        id={id}
        type="text"
        className="form-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        data-testid={testid}
      />
      <button
        type="button"
        className="btn btn-secondary"
        onClick={handleSelect}
        aria-label={t("common.browse")}
        data-testid={`${testid}-browse`}
      >
        {t("common.browse")}
      </button>
    </div>
  );
}
