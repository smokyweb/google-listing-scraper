import { useState } from 'react';
import { login } from '../api';

export default function Login({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(password);
      onLogin();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-xl p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold text-white mb-1">GLS Admin</h1>
        <p className="text-sm text-gray-500 mb-6">Enter password to continue</p>
        {error && <div className="bg-red-900/50 border border-red-800 text-red-300 text-sm p-3 rounded-lg mb-4">{error}</div>}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-4"
          autoFocus
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
        <p className="text-xs text-gray-600 mt-4 text-center">Default password: admin</p>
      </form>
    </div>
  );
}
