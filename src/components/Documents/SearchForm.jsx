import { useState, useEffect } from 'react';
import { docuwareService } from '../../services/docuwareService';
import LoadingSpinner from '../Common/LoadingSpinner';
import ErrorMessage from '../Common/ErrorMessage';

const SearchForm = ({ onSearch, onLog, totalCount = 0, onCabinetChange }) => {
    const [cabinets, setCabinets] = useState([]);
    const [selectedCabinet, setSelectedCabinet] = useState(''); // Start empty, validate localStorage later
    const [fields, setFields] = useState([]);
    const [allFields, setAllFields] = useState([]); // Store all raw fields
    const [suggestions, setSuggestions] = useState({}); // { [index]: [values] }
    const [filters, setFilters] = useState([{ fieldName: '', value: '' }]);
    const [resultLimit, setResultLimit] = useState(1000); // Default to 1000
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchCabinets();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (selectedCabinet) {
            fetchFields();
            // Notify parent if we have a stored cabinet
            if (onCabinetChange) {
                // Find name if possible
                const cabinet = cabinets.find(c => c.Id === selectedCabinet);
                if (cabinet) onCabinetChange(selectedCabinet, cabinet.Name);
            }
        }
    }, [selectedCabinet]);

    const fetchCabinets = async () => {
        try {
            setLoading(true);
            onLog('Fetching file cabinets...');
            const data = await docuwareService.getCabinets();
            const sortedData = data.sort((a, b) => a.Name.localeCompare(b.Name));
            setCabinets(sortedData);
            onLog(`Found ${data.length} file cabinets`);

            // Validate and restore selection from localStorage
            const storedId = localStorage.getItem('selectedCabinetId');
            if (storedId) {
                const isValid = sortedData.some(c => c.Id === storedId);
                if (isValid) {
                    console.log(`Restoring valid cabinet selection: ${storedId}`);
                    setSelectedCabinet(storedId);
                } else {
                    console.warn(`Stored cabinet ID ${storedId} not found. Clearing.`);
                    localStorage.removeItem('selectedCabinetId');
                }
            }
        } catch (err) {
            console.error('Cabinet fetch error:', err);
            if (err.message.includes('401') || (err.response && err.response.status === 401)) {
                setError('Sessão expirada. Por favor, faça logout e entre novamente no sistema.');
            } else {
                setError('Failed to load cabinets: ' + err.message);
            }
            onLog('Error: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    const fetchFields = async () => {
        try {
            setLoading(true);
            onLog(`Fetching fields for cabinet ${selectedCabinet}...`);
            const data = await docuwareService.getCabinetFields(selectedCabinet);

            // Store raw data for passing to parent
            setAllFields(data || []);

            // Filter to show only user-visible fields (not system fields)
            const userFields = (data || [])
                .filter(f => !f.SystemField && f.DWFieldType !== 'Memo')
                .sort((a, b) => (a.DisplayName || a.FieldName).localeCompare(b.DisplayName || b.FieldName));
            setFields(userFields);
            onLog(`Found ${userFields.length} searchable fields`);

            // SMART DEFAULT FILTER: Auto-select "Tipo de documento"
            const preferredMatch = ['tipo de documento', 'tipo documento'];
            const defaultField = userFields.find(f => {
                const label = (f.DisplayName || f.FieldName).toLowerCase();
                return preferredMatch.some(p => label === p || label.includes(p));
            });

            if (defaultField) {
                setFilters(prev => {
                    // Only set if we have a single empty filter (fresh state)
                    if (prev.length === 1 && !prev[0].fieldName) {
                        return [{ fieldName: defaultField.DBFieldName, value: '' }];
                    }
                    return prev;
                });
            }
        } catch (err) {
            setError('Failed to load fields: ' + err.message);
            onLog('Error: ' + err.message);
            setFields([]);
            setAllFields([]);
        } finally {
            setLoading(false);
        }
    };

    const handleAddFilter = () => {
        setFilters([...filters, { fieldName: '', value: '' }]);
    };

    const handleRemoveFilter = (index) => {
        setFilters(filters.filter((_, i) => i !== index));
    };

    const handleFilterChange = (index, field, value) => {
        const newFilters = [...filters];
        newFilters[index][field] = value;
        setFilters(newFilters);
    };

    const handleSearch = () => {
        if (!selectedCabinet) {
            setError('Please select a file cabinet');
            return;
        }

        // Filter out empty filters
        const validFilters = filters.filter(f => f.fieldName && f.value);

        onLog(`Searching in cabinet ${selectedCabinet} with ${validFilters.length} filters...`);
        // Pass all raw fields as the 3rd argument and resultLimit as 4th
        onSearch(selectedCabinet, validFilters, allFields, resultLimit);
    };

    if (loading) return <LoadingSpinner />;

    return (
        <div className="card bg-base-100 shadow-md">
            <div className="card-body p-4">


                {error && <ErrorMessage message={error} />}

                {/* Cabinet Selection */}
                <div className="form-control mb-2">
                    <label className="label py-1">
                        <span className="label-text font-medium text-xs">File Cabinet</span>
                    </label>
                    <select
                        className="select select-bordered select-sm w-full"
                        value={selectedCabinet}
                        onChange={(e) => {
                            const newValue = e.target.value;
                            setSelectedCabinet(newValue);

                            if (newValue) {
                                localStorage.setItem('selectedCabinetId', newValue);
                            } else {
                                localStorage.removeItem('selectedCabinetId');
                            }

                            if (onCabinetChange) {
                                const cabinet = cabinets.find(c => c.Id === newValue);
                                onCabinetChange(newValue, cabinet ? cabinet.Name : '');
                            }
                        }}
                    >
                        <option value="">Selecione o armário</option>
                        {cabinets.map((cab) => (
                            <option key={cab.Id} value={cab.Id}>
                                {cab.Name}
                            </option>
                        ))}
                    </select>
                </div>



                {/* Filters */}
                {selectedCabinet && fields.length > 0 && (
                    <div className="mt-2">
                        <div className="flex justify-between items-center mb-1">
                            <label className="label py-0">
                                <span className="label-text font-semibold text-xs">Filters</span>
                            </label>
                            <button
                                className="btn btn-xs btn-outline"
                                onClick={handleAddFilter}
                            >
                                + Add Filter
                            </button>
                        </div>

                        {filters.map((filter, index) => (
                            <div key={index} className="flex gap-2 mb-2">
                                <select
                                    className="select select-bordered select-sm flex-1 text-xs"
                                    value={filter.fieldName}
                                    onChange={async (e) => {
                                        const fieldName = e.target.value;
                                        handleFilterChange(index, 'fieldName', fieldName);
                                        // Clear value when field changes
                                        handleFilterChange(index, 'value', '');

                                        // Fetch suggestions
                                        if (fieldName && selectedCabinet) {
                                            try {
                                                const values = await docuwareService.getSelectList(selectedCabinet, fieldName);
                                                // Sort alphabetically ascending
                                                const sortedValues = values.sort((a, b) =>
                                                    String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
                                                );

                                                // Store suggestions in specific state or just simple way? 
                                                // Simplified: use a temp state or modify filter object? 
                                                // Better: Use a separate state for suggestions mapping: { [index]: [] }
                                                setSuggestions(prev => ({ ...prev, [index]: sortedValues }));
                                            } catch (err) {
                                                console.error(err);
                                            }
                                        }
                                    }}
                                >
                                    <option value="">Select field...</option>
                                    {fields.map((field) => {
                                        const dbName = field.DBFieldName || field.DBName || field.Name;
                                        return (
                                            <option key={dbName} value={dbName}>
                                                {field.DisplayName || dbName}
                                            </option>
                                        );
                                    })}
                                </select>

                                <div className="flex-1 relative">
                                    <input
                                        type="text"
                                        list={`suggestions-${index}`}
                                        className="input input-bordered input-sm w-full text-xs"
                                        placeholder="Value..."
                                        value={filter.value}
                                        onFocus={async () => {
                                            // Load suggestions if empty and field is selected
                                            if (filter.fieldName && (!suggestions[index] || suggestions[index].length === 0)) {
                                                const values = await docuwareService.getSelectList(selectedCabinet, filter.fieldName);
                                                const sortedValues = values.sort((a, b) =>
                                                    String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
                                                );
                                                setSuggestions(prev => ({ ...prev, [index]: sortedValues }));
                                            }
                                        }}
                                        onChange={(e) => handleFilterChange(index, 'value', e.target.value)}
                                    />
                                    <datalist id={`suggestions-${index}`}>
                                        {suggestions[index]?.map((val, i) => (
                                            <option key={i} value={val} />
                                        ))}
                                    </datalist>
                                </div>

                                {filters.length > 1 && (
                                    <button
                                        className="btn btn-error btn-outline btn-xs"
                                        onClick={() => handleRemoveFilter(index)}
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Bottom Row: Total Count (Left) & Limit Selector + Search Button (Right) */}
                <div className="flex justify-between items-end mt-2">
                    {/* Total Count Display - Moved here */}
                    <div>
                        {selectedCabinet && (
                            <div className="alert alert-info py-1 px-3 shadow-sm inline-flex h-8 min-h-0 items-center">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                <span className="text-xs">Total docs: <span className="font-bold">{totalCount}</span></span>
                            </div>
                        )}
                    </div>

                    {/* Limit Selector + Search Button */}
                    <div className="flex gap-2 items-center">
                        <div className="form-control">
                            <label className="label py-0 px-0 mb-1">
                                <span className="label-text text-xs">Result Limit</span>
                            </label>
                            <select
                                className="select select-bordered select-sm text-xs w-32"
                                value={resultLimit}
                                onChange={(e) => setResultLimit(Number(e.target.value))}
                            >
                                <option value={100}>100</option>
                                <option value={500}>500</option>
                                <option value={1000}>1,000</option>
                                <option value={2000}>2,000</option>
                                <option value={999999}>All</option>
                            </select>
                        </div>
                        <button
                            className="btn btn-primary btn-sm self-end"
                            onClick={handleSearch}
                            disabled={!selectedCabinet}
                        >
                            Search
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SearchForm;
