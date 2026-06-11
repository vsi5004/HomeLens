import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import App from "./App";
import DashboardPage from "./pages/DashboardPage";
import AddPropertyPage from "./pages/AddPropertyPage";
import MapPage from "./pages/MapPage";
import ReportsPage from "./pages/ReportsPage";
import SettingsPage from "./pages/SettingsPage";
import DataSourcesPage from "./pages/DataSourcesPage";
import PropertyPage from "./pages/PropertyPage";

import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {/* HashRouter is used because the app is served from a custom protocol in the
        Tauri webview, where path-based routing can be brittle. */}
    <HashRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="add" element={<AddPropertyPage />} />
          <Route path="property/:id" element={<PropertyPage />} />
          <Route path="map" element={<MapPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="data-sources" element={<DataSourcesPage />} />
        </Route>
      </Routes>
    </HashRouter>
  </React.StrictMode>,
);
