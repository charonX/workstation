import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import enUS from "./en-US.json";
import zhCN from "./zh-CN.json";

const resources = {
  "en-US": { translation: enUS },
  "zh-CN": { translation: zhCN },
};

i18next.use(initReactI18next).init({
  resources,
  lng: "en-US",
  fallbackLng: "en-US",
  interpolation: {
    escapeValue: false,
  },
});

export default i18next;

export function changeLanguage(lng) {
  return i18next.changeLanguage(lng);
}
