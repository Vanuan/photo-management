import React, { type ReactNode } from "react";

interface MainLayoutProps {
  children: ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  return (
    <div className="relative w-screen h-screen overflow-hidden flex flex-col bg-gray-900 font-sans">
      {children}
    </div>
  );
};

export default MainLayout;
