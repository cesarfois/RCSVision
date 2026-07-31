import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import ErrorMessage from '../Common/ErrorMessage';
import LoadingSpinner from '../Common/LoadingSpinner';

const LoginForm = () => {
    const { login } = useAuth();
    const [url, setUrl] = useState('https://rcsangola.docuware.cloud');
    const [username, setUsername] = useState('cesar.fois.ext@rcsangola.com');
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await login(url, username, password);
        } catch (err) {
            setError(err.message || 'Login falhou. Verifique suas credenciais e a URL.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen w-full flex flex-col md:flex-row shadow-2xl overflow-hidden">

            {/* Left Panel - Branding (The Experience) */}
            <div className="w-full md:w-1/2 bg-[#0a1e3f] flex flex-col items-center justify-center p-12 text-center relative overflow-hidden">
                {/* Background Pattern (Optional subtle texture) */}
                {/* Background Pattern Removed for seamless image blending */}

                <div className="z-10 flex flex-col items-center animate-fade-in-up gap-6 -mt-32">
                    {/* Element 1: Icon */}
                    <img
                        src="/login-icon-v12.png"
                        alt="RCS Vision Icon"
                        className="w-auto h-32 object-contain drop-shadow-2xl animate-fade-in"
                    />

                    {/* Element 2: Text Logo */}
                    <img
                        src="/login-text-v18.png"
                        alt="RCS Vision Text"
                        className="w-auto max-w-[80%] object-contain drop-shadow-2xl animate-fade-in-up delay-100"
                    />

                    {/* Element 3: Tagline */}
                    <p className="text-gray-300 text-lg font-light max-w-md animate-fade-in-up delay-200">
                        Acesse sua visão estratégica de documentos e workflows.
                    </p>
                </div>
            </div>

            {/* Right Panel - Login Form (The Function) */}
            <div className="w-full md:w-1/2 bg-white flex items-center justify-center p-8 md:p-16">
                <div className="w-full max-w-md space-y-8">
                    <div className="text-center md:text-left">
                        <h2 className="text-3xl font-bold text-[#0a1e3f]">
                            Bem-vindo de volta
                        </h2>
                        <p className="mt-2 text-gray-500">
                            Por favor, insira suas credenciais para entrar.
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="mt-8 space-y-6">
                        <div className="space-y-4">
                            {/* Platform URL */}
                            <div>
                                <label htmlFor="url" className="text-sm font-medium text-gray-700 block mb-1">
                                    Platform URL
                                </label>
                                <input
                                    id="url"
                                    name="url"
                                    type="text"
                                    required
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-[#00bfff] focus:ring-2 focus:ring-[#00bfff]/20 outline-none transition-all placeholder-gray-400 text-gray-900 bg-white"
                                    placeholder="https://example.docuware.cloud"
                                />
                            </div>

                            {/* Username */}
                            <div>
                                <label htmlFor="username" className="text-sm font-medium text-gray-700 block mb-1">
                                    Usuário
                                </label>
                                <input
                                    id="username"
                                    name="username"
                                    type="text"
                                    required
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-[#00bfff] focus:ring-2 focus:ring-[#00bfff]/20 outline-none transition-all placeholder-gray-400 text-gray-900 bg-white"
                                    placeholder="Seu usuário DocuWare"
                                />
                            </div>

                            {/* Password */}
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label htmlFor="password" class="text-sm font-medium text-gray-700">
                                        Senha
                                    </label>
                                </div>
                                <input
                                    id="password"
                                    name="password"
                                    type="password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-[#00bfff] focus:ring-2 focus:ring-[#00bfff]/20 outline-none transition-all placeholder-gray-400 text-gray-900 bg-white"
                                    placeholder="••••••••"
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded">
                                <p className="text-sm text-red-700">{error}</p>
                            </div>
                        )}

                        <div>
                            <button
                                type="submit"
                                disabled={loading}
                                className={`
                                    w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-bold text-white 
                                    bg-[#00bfff] hover:bg-[#00ace6] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#00bfff] 
                                    transition-all duration-200 transform hover:-translate-y-0.5
                                    ${loading ? 'opacity-70 cursor-not-allowed' : ''}
                                `}
                            >
                                {loading ? <LoadingSpinner size="sm" color="white" /> : 'Entrar'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default LoginForm;
