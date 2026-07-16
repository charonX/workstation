import Sidebar from "./Sidebar.jsx";
import TopBar from "./TopBar.jsx";

export default function PageLayout({ children }) {
  return (
    <div className="app-shell">
      <TopBar />
      <Sidebar />
      <main className="app-main">{children}</main>
    </div>
  );
}
