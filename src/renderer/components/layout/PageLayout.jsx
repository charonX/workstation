import Sidebar from "./Sidebar.jsx";
import TopBar from "./TopBar.jsx";

export default function PageLayout({ children }) {
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-main">
        <TopBar />
        <div className="app-content">{children}</div>
      </div>
    </div>
  );
}
