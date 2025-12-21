import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
    FaSearch,
    FaChartBar,
    FaChartLine,
    FaProjectDiagram,
    FaShieldAlt,
    FaDownload,
    FaFolderOpen,
    FaBars,
    FaChevronLeft,
    FaChevronRight
} from 'react-icons/fa';

const Sidebar = ({ isCollapsed, toggleSidebar }) => {
    const location = useLocation();

    // Define navigation items based on current Navbar
    const navItems = [
        { path: '/', label: 'Pesquisa', icon: <FaSearch /> },
        { path: '/analytics', label: 'Analytics', icon: <FaChartBar /> },
        { path: '/fluxo', label: 'Análise de Fluxo', icon: <FaProjectDiagram /> },
        { path: '/admin-workflow-analytics', label: 'Admin Workflows', icon: <FaShieldAlt />, highlight: true },
        { path: '/performance', label: 'Gestão de Performance', icon: <FaChartLine /> },
        { path: '/download', label: 'Baixar Arquivos', icon: <FaDownload /> },
        { path: '/controle-documental', label: 'Controle Documental', icon: <FaFolderOpen /> },
    ];

    return (
        <aside
            className={`
                fixed left-0 top-0 h-full z-30 transition-all duration-300 ease-in-out
                flex flex-col shadow-xl
                ${isCollapsed ? 'w-20' : 'w-[230px]'}
            `}
        >
            {/* Sidebar Header with Responsive Icon */}
            <div className={`
                flex items-center justify-center flex-none
                bg-[#0a1e3f] border-b border-white/10
                transition-all duration-300
                ${isCollapsed ? 'h-16' : 'h-24'}
            `}>
                <img
                    src="/sidebar-icon.png"
                    alt="Menu Icon"
                    className={`
                        transition-all duration-300 object-contain
                        ${isCollapsed ? 'w-8 h-8' : 'w-20 h-20'}
                    `}
                />
            </div>
            {/* Navigation (Dark Blue) */}
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto bg-[#0a1e3f] text-white">
                {navItems.map((item) => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        title={isCollapsed ? item.label : ''}
                        className={({ isActive }) => `
                            flex items-center gap-3 px-3 py-2 mx-1 rounded-lg transition-all duration-200 group relative
                            ${isActive
                                ? 'bg-white/10 text-white'
                                : 'text-gray-400 hover:text-white hover:bg-white/5'
                            }
                        `}
                    >
                        {({ isActive }) => (
                            <>
                                <span className={`text-[20px] transition-colors ${item.highlight ? 'text-cyan-400' : ''}`}>
                                    {item.icon}
                                </span>

                                <span className={`text-[14px] font-normal whitespace-nowrap transition-all duration-300 origin-left
                                    ${isCollapsed ? 'w-0 opacity-0 scale-0' : 'w-auto opacity-100 scale-100'}
                                    ${item.highlight ? 'text-cyan-400' : ''}
                                `}>
                                    {item.label}
                                </span>

                                {/* Active Indicator Bar */}
                                <div className={`
                                    absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-cyan-400 transition-all duration-300
                                    ${isActive ? 'opacity-100' : 'opacity-0'}
                                `} />
                            </>
                        )}
                    </NavLink>
                ))}
            </nav>

            {/* Footer / Toggle (Dark Blue) */}
            <div className="p-4 border-t border-white/10 bg-[#0a1e3f]">
                <button
                    onClick={toggleSidebar}
                    className="w-full flex items-center justify-center p-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-colors"
                >
                    {isCollapsed ? <FaChevronRight /> : <div className="flex items-center gap-3 px-1"><FaChevronLeft /> <span>Recolher</span></div>}
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;
