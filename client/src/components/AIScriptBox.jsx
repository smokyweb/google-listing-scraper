import { useState } from 'react';
import { apiFetch } from '../api';

export default function AIScriptBox({ type, onGenerated, placeholder }) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch('/ai/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt: prompt.trim(), type }),
      });
      onGenerated(data.script);
      setPrompt('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-indigo-950/40 border border-indigo-800/50 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-indigo-300">✨ AI Script Generator</span>
        <span className="text-xs text-indigo-500">(powered by Gemini)</span>
      </div>
      <div className="flex gap-2">
        <input
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleGenerate()}
          placeholder={placeholder || 'Describe the script you want... e.g. "Friendly outreach for plumbers in Texas"'}
          className="flex-1 px-3 py-1.5 bg-indigo-950/60 border border-indigo-700/50 rounded-lg text-white text-sm placeholder-indigo-500 focus:outline-none focus:border-indigo-500"
        />
        <button
          onClick={handleGenerate}
          disabled={loading || !prompt.trim()}
          className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {loading ? '✨ Generating...' : '✨ Generate'}
        </button>
      </div>
      {error && <p className="text-xs text-red-400 mt-1.5">{error.includes('not configured') ? '⚠ Add your Gemini API key in Settings to use AI generation.' : error}</p>}
    </div>
  );
}
