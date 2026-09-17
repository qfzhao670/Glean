import { useState } from 'react';
import { Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { post } from '../api';

type SecretName = 'api_key' | 'transcription_key';

export default function SecretField({ name, label, value, saved, placeholder, onChange, onError }: {
  name: SecretName;
  label: string;
  value: string | null;
  saved: boolean;
  placeholder: string;
  onChange: (value: string | null) => void;
  onError: (message: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (visible) { setVisible(false); return; }
    if (saved && value === '') {
      setLoading(true);
      try {
        const result = await post<{ value: string }>(`/settings/secrets/${name}/reveal`);
        onChange(result.value);
      } catch (error) {
        onError((error as Error).message);
        return;
      } finally { setLoading(false); }
    }
    setVisible(true);
  }

  return <div className="secret-field">
    <input id={name} aria-label={label} type={visible ? 'text' : 'password'} autoComplete="off" spellCheck={false}
      disabled={loading} value={value || ''} placeholder={value === null ? '保存后清除密钥' : saved ? '已保存，点击眼睛查看' : placeholder}
      onChange={event => onChange(event.target.value)}/>
    <div className="secret-actions">
      <button type="button" className="secret-visibility" onClick={toggle} disabled={loading}
        aria-label={`${visible ? '隐藏' : '显示'}${label}`} aria-pressed={visible} title={visible ? '隐藏密钥' : '显示密钥'}>
        {loading ? <LoaderCircle size={16} className="spin"/> : visible ? <EyeOff size={16}/> : <Eye size={16}/>}
      </button>
      {(saved || value) && <button type="button" onClick={() => { onChange(null); setVisible(false); }} disabled={loading} aria-label={`清除${label}`}>清除</button>}
    </div>
  </div>;
}
