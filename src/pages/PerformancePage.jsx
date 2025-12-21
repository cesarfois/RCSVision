import { useState, useMemo, useEffect } from 'react';
import { useOptimizedWorkflows } from '../hooks/useOptimizedWorkflows';
import { adminWorkflowService } from '../services/adminWorkflowService';
import { docuwareService } from '../services/docuwareService';
import { FaCalendarAlt, FaSearch, FaChartLine, FaCheckCircle, FaExclamationTriangle, FaFileInvoiceDollar, FaSync, FaFilter, FaProjectDiagram } from 'react-icons/fa';

const PerformancePage = () => {
    // Hooks
    const { workflows, isLoading: workflowsLoading } = useOptimizedWorkflows();

    // State
    const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
    const [selectedDocType, setSelectedDocType] = useState('');
    const [availableDocTypes, setAvailableDocTypes] = useState([]);
    const [loadingDocTypes, setLoadingDocTypes] = useState(false);

    const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0, status: '' });
    const [reportData, setReportData] = useState(null);
    const [error, setError] = useState(null);

    // Derived: Selected Workflow Object
    const selectedWorkflow = useMemo(() => {
        return workflows?.find(w => w.id === selectedWorkflowId) || null;
    }, [workflows, selectedWorkflowId]);

    // Effect: Load DocTypes when Workflow (Cabinet) changes
    useEffect(() => {
        if (!selectedWorkflow?.fileCabinetId) {
            setAvailableDocTypes([]);
            return;
        }

        const fetchDocTypes = async () => {
            setLoadingDocTypes(true);
            try {
                // Fetch unique values for DOCUMENT_TYPE field
                const types = await docuwareService.getSelectList(selectedWorkflow.fileCabinetId, 'DOCUMENT_TYPE');
                setAvailableDocTypes(types.sort());
            } catch (err) {
                console.warn('Failed to load doc types', err);
                setAvailableDocTypes([]);
            } finally {
                setLoadingDocTypes(false);
            }
        };

        fetchDocTypes();
    }, [selectedWorkflow]);

    // Main Logic
    const generateReport = async () => {
        if (!selectedWorkflow) {
            setError('Selecione um Fluxo de Trabalho.');
            return;
        }

        setLoading(true);
        setError(null);
        setReportData(null);
        setProgress({ current: 0, total: 0, status: 'Buscando documentos...' });

        try {
            const cabinetId = selectedWorkflow.fileCabinetId;

            // 1. Define Date Range (Full Month)
            const [year, month] = selectedMonth.split('-');
            const startDate = new Date(year, month - 1, 1);
            const endDate = new Date(year, month, 0, 23, 59, 59); // Last day of month

            // 2. Fetch Docs modified in that month + DocType Filter
            // If no doc type selected, we search generic (optional behavior, prompts says to use DialogExpression for type)
            const filterType = selectedDocType || null;

            const docs = await adminWorkflowService.getDocumentsByDateRange(cabinetId, startDate, endDate, filterType);

            if (docs.length === 0) {
                setReportData([]);
                setLoading(false);
                return;
            }

            setProgress({ current: 0, total: docs.length, status: 'Analisando histórico de performance...' });

            // 3. Process batches (History)
            const userStats = {};

            // Tasks to strictly look for - currently hardcoded based on prompt, but could be dynamic
            const TARGET_TASKS = ['Classificação das Guias', 'Confirmação', 'Aprovação'];

            const BATCH_SIZE = 5;
            for (let i = 0; i < docs.length; i += BATCH_SIZE) {
                const batch = docs.slice(i, i + BATCH_SIZE);

                await Promise.all(batch.map(async (doc) => {
                    try {
                        const history = await adminWorkflowService.getWorkflowHistory(cabinetId, doc.Id);

                        history.forEach(event => {
                            // Logic: Look for Human Task completion
                            // We focus on events that have "Users" (who did it) and "DecisionLabel" (what they did)

                            if (event.Users && event.DecisionLabel) {
                                const userEmail = event.Users[0]?.Name || 'Unknown';
                                const userName = event.Users[0]?.DisplayName || userEmail;
                                const taskName = event.ActivityType || 'Tarefa Genérica'; // Sometimes needs ActivityLabel

                                // Initialize User Stats
                                if (!userStats[userEmail]) {
                                    userStats[userEmail] = {
                                        name: userName,
                                        totalTasks: 0,
                                        tasks: {} // Detailed breakdown
                                    };
                                }

                                userStats[userEmail].totalTasks++;

                                // Track specific task types
                                const decision = event.DecisionLabel;
                                if (!userStats[userEmail].tasks[decision]) {
                                    userStats[userEmail].tasks[decision] = 0;
                                }
                                userStats[userEmail].tasks[decision]++;
                            }
                        });
                    } catch (e) {
                        console.warn(`Error processing doc ${doc.Id}`, e);
                    }
                }));

                setProgress(prev => ({ ...prev, current: Math.min(prev.current + BATCH_SIZE, docs.length) }));
            }

            const finalArray = Object.values(userStats).sort((a, b) => b.totalTasks - a.totalTasks);
            setReportData(finalArray);

        } catch (err) {
            console.error('Report Generation Failed:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-base-200 p-6 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-white rounded-xl shadow-sm">
                        <FaChartLine className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800">Gestão de Performance</h1>
                        <p className="text-gray-500 text-sm">Auditoria de produtividade por Fluxo e Tipo Documental</p>
                    </div>
                </div>
            </div>

            {/* Filters Card */}
            <div className="card bg-base-100 shadow-lg mb-6 flex-none">
                <div className="card-body p-4">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">

                        {/* Month Picker */}
                        <div className="form-control">
                            <label className="label">
                                <span className="label-text font-semibold flex items-center gap-2">
                                    <FaCalendarAlt /> Mês de Referência
                                </span>
                            </label>
                            <input
                                type="month"
                                className="input input-bordered w-full"
                                value={selectedMonth}
                                onChange={(e) => setSelectedMonth(e.target.value)}
                            />
                        </div>

                        {/* Workflow Selector */}
                        <div className="form-control">
                            <label className="label">
                                <span className="label-text font-semibold flex items-center gap-2">
                                    <FaProjectDiagram /> Fluxo de Trabalho
                                </span>
                            </label>
                            <select
                                className="select select-bordered w-full"
                                value={selectedWorkflowId}
                                onChange={(e) => setSelectedWorkflowId(e.target.value)}
                                disabled={workflowsLoading}
                            >
                                <option value="">Selecione um fluxo...</option>
                                {workflows?.map(wf => (
                                    <option key={wf.id} value={wf.id}>{wf.name}</option>
                                ))}
                            </select>
                        </div>

                        {/* DocType Selector (Dynamic) */}
                        <div className="form-control">
                            <label className="label">
                                <span className="label-text font-semibold flex items-center gap-2">
                                    <FaFilter /> Tipo Documental
                                </span>
                            </label>
                            <select
                                className="select select-bordered w-full"
                                value={selectedDocType}
                                onChange={(e) => setSelectedDocType(e.target.value)}
                                disabled={!selectedWorkflow || loadingDocTypes}
                            >
                                <option value="">Todos os tipos</option>
                                {availableDocTypes.map(type => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>
                        </div>

                        {/* Action Button */}
                        <button
                            className={`btn btn-primary gap-2 ${loading ? 'loading' : ''}`}
                            onClick={generateReport}
                            disabled={loading || !selectedWorkflow}
                        >
                            {!loading && <FaSync />} Extratar Dados
                        </button>
                    </div>

                    {error && (
                        <div className="alert alert-error mt-4 shadow-sm">
                            <FaExclamationTriangle />
                            <span>{error}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Progress Bar */}
            {loading && (
                <div className="w-full mb-6 animate-fade-in">
                    <div className="flex justify-between text-xs font-semibold uppercase text-gray-500 mb-1">
                        <span>{progress.status}</span>
                        <span>{Math.round((progress.current / progress.total) * 100)}%</span>
                    </div>
                    <progress className="progress progress-primary w-full h-3" value={progress.current} max={progress.total}></progress>
                </div>
            )}

            {/* Results Area */}
            {reportData && (
                <div className="flex-1 overflow-hidden flex flex-col animate-fade-in-up">

                    {/* KPI Summary */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 flex-none">
                        <div className="stats shadow">
                            <div className="stat">
                                <div className="stat-figure text-primary">
                                    <FaCheckCircle className="w-8 h-8 opacity-20" />
                                </div>
                                <div className="stat-title">Ações Registradas</div>
                                <div className="stat-value text-primary">
                                    {reportData.reduce((acc, u) => acc + u.totalTasks, 0)}
                                </div>
                                <div className="stat-desc">Movimentações no fluxo</div>
                            </div>
                        </div>
                    </div>

                    {/* Table */}
                    <div className="card bg-base-100 shadow-xl flex-1 overflow-hidden border border-base-200">
                        <div className="card-body p-0 overflow-auto">
                            <table className="table table-zebra w-full sticky-header">
                                <thead className="bg-[#f4f7f9] text-gray-600 sticky top-0 z-10">
                                    <tr>
                                        <th className="py-4 pl-6 text-sm">Colaborador</th>
                                        <th className="py-4 text-center text-sm">Total de Ações</th>
                                        <th className="py-4 text-left text-sm">Detalhamento (Top 3 Ações)</th>
                                        <th className="py-4 text-right pr-6 text-sm">Classificação</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {reportData.map((user, idx) => (
                                        <tr key={idx} className="hover">
                                            <td className="pl-6 font-medium text-gray-700">
                                                <div className="flex items-center gap-3">
                                                    <div className="avatar placeholder">
                                                        <div className="bg-neutral-focus text-neutral-content rounded-full w-8">
                                                            <span className="text-xs">{user.name.slice(0, 2).toUpperCase()}</span>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div className="font-bold">{user.name}</div>
                                                        <div className="text-xs text-gray-400">ID: {idx + 1}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="text-center font-bold text-lg">{user.totalTasks}</td>
                                            <td className="text-left text-xs text-gray-500">
                                                {Object.entries(user.tasks)
                                                    .sort(([, a], [, b]) => b - a)
                                                    .slice(0, 3)
                                                    .map(([task, count]) => (
                                                        <div key={task} className="badge badge-ghost badge-sm mr-1 mb-1">
                                                            {task}: {count}
                                                        </div>
                                                    ))
                                                }
                                            </td>
                                            <td className="text-right pr-6">
                                                <div className="badge badge-success gap-2">
                                                    Produtivo
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {reportData.length === 0 && (
                                        <tr>
                                            <td colSpan="4" className="text-center py-8 text-gray-400">
                                                Nenhum registro encontrado para este filtro.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PerformancePage;
