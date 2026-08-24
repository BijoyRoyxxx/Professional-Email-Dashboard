import { useState, useEffect, useRef } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css'; 

const API_BASE_URL = 'https://professional-email-dashboard.onrender.com';

export default function App() {
  // Auth State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // App State
  const [mode, setMode] = useState('single');
  const [toEmail, setToEmail] = useState('');
  const [ccEmail, setCcEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [msg, setMsg] = useState('');
  const [file, setFile] = useState(null);
  
  const [isSending, setIsSending] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [isDraftingSubject, setIsDraftingSubject] = useState(false);
  const [logs, setLogs] = useState([]);
  
  const [aiTone, setAiTone] = useState('Professional');
  const fileInputRef = useRef(null);

  // CRM State
  const [contacts, setContacts] = useState([]);
  const [newContactName, setNewContactName] = useState('');
  const [newContactEmail, setNewContactEmail] = useState('');

  // Check if logged in on load
  useEffect(() => {
    if (localStorage.getItem('isAuth') === 'true') {
      setIsAuthenticated(true);
    }
  }, []);

  // AUTO-SAVE & LOAD
  useEffect(() => {
    const savedMsg = localStorage.getItem('draftMsg');
    const savedSub = localStorage.getItem('draftSub');
    const savedContacts = localStorage.getItem('crmContacts');
    
    if (savedMsg) setMsg(savedMsg);
    if (savedSub) setSubject(savedSub);
    if (savedContacts) setContacts(JSON.parse(savedContacts));
    
    if (isAuthenticated) fetchLogs();
  }, [isAuthenticated]);

  useEffect(() => {
    localStorage.setItem('draftMsg', msg);
    localStorage.setItem('draftSub', subject);
  }, [msg, subject]);

  useEffect(() => {
    localStorage.setItem('crmContacts', JSON.stringify(contacts));
  }, [contacts]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setAuthError('');
    
    try {
      const res = await fetch(`${API_BASE_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authUsername, password: authPassword })
      });
      
      const data = await res.json();
      if (data.success) {
        setIsAuthenticated(true);
        localStorage.setItem('isAuth', 'true');
      } else {
        setAuthError(data.error);
      }
    } catch (error) {
      setAuthError("Server communication failed.");
    }
    setIsLoggingIn(false);
  };

  const handleLogout = () => {
    localStorage.removeItem('isAuth');
    setIsAuthenticated(false);
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/logs`);
      if (res.ok) setLogs(await res.json());
    } catch (error) { console.error("Could not fetch logs."); }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    setIsSending(true);

    if (mode === 'single') {
      try {
        const response = await fetch(`${API_BASE_URL}/api/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to_email: toEmail, cc_email: ccEmail, subject: subject || '(No Subject)', message: msg })
        });
        if (response.ok) {
          setToEmail(''); setCcEmail(''); setSubject(''); setMsg('');
          fetchLogs(); 
        }
      } catch (error) { alert('Failed to reach the server.'); }
    } else {
      if (!file) {
        alert('Please select a CSV file first.');
        setIsSending(false);
        return;
      }
      const formData = new FormData();
      formData.append('file', file);
      formData.append('subject', subject || '(No Subject)');
      formData.append('message', msg); 

      try {
        const response = await fetch(`${API_BASE_URL}/api/bulk-send`, {
          method: 'POST',
          body: formData 
        });
        if (response.ok) {
          setFile(null); setSubject(''); setMsg('');
          if (fileInputRef.current) fileInputRef.current.value = "";
          fetchLogs(); 
        }
      } catch (error) { alert('Bulk upload failed.'); }
    }
    setIsSending(false);
  };

  const handleSmartDraft = async () => {
    if (!msg || msg === '<p><br></p>') return alert("Please type a few words into the message box first!");
    setIsDrafting(true);
    try {
      const plainText = msg.replace(/<[^>]*>?/gm, ''); 
      const enhancedPrompt = `Write this using a ${aiTone} tone: ${plainText}`;
      
      const res = await fetch(`${API_BASE_URL}/api/ai/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text_content: enhancedPrompt }) 
      });
      if (res.ok) {
        const data = await res.json();
        setMsg(data.draft);
      }
    } catch (error) { alert("AI drafting failed."); } 
    finally { setIsDrafting(false); }
  };

  const handleAISubject = async () => {
    if (!msg || msg === '<p><br></p>') return alert("Please draft your email body first!");
    setIsDraftingSubject(true);
    try {
      const plainText = msg.replace(/<[^>]*>?/gm, ''); 
      
      const res = await fetch(`${API_BASE_URL}/api/ai/subject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text_content: plainText }) 
      });
      if (res.ok) {
        const data = await res.json();
        setSubject(data.subject);
      }
    } catch (error) { alert("AI subject generation failed."); } 
    finally { setIsDraftingSubject(false); }
  };

  const addContact = () => {
    if (!newContactName || !newContactEmail) return;
    setContacts([...contacts, { name: newContactName, email: newContactEmail }]);
    setNewContactName('');
    setNewContactEmail('');
  };

  const removeContact = (index) => {
    const updated = contacts.filter((_, i) => i !== index);
    setContacts(updated);
  };

  const applyTemplate = (templateText) => { setMsg(templateText); };

  const totalSent = logs.length;
  const successfulSends = logs.filter(l => l.status.includes('Success')).length;
  const successRate = totalSent === 0 ? 0 : Math.round((successfulSends / totalSent) * 100);

  // --- LOGIN SCREEN RENDER ---
  if (!isAuthenticated) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <style>{`
          * { box-sizing: border-box; }
          .app-container { min-height: 100vh; background: #050505; padding: 30px 20px 10px 20px; font-family: 'Inter', system-ui, sans-serif; position: relative; overflow-x: hidden; z-index: 1; display: flex; flex-direction: column; }
          .ambient-orb { position: absolute; border-radius: 50%; filter: blur(90px); z-index: -1; animation: float 12s infinite ease-in-out alternate; }
          .orb-1 { width: 40vw; height: 40vw; background: rgba(59, 130, 246, 0.25); top: -10%; left: 5%; }
          .orb-2 { width: 50vw; height: 50vw; background: rgba(168, 85, 247, 0.2); bottom: -10%; right: -5%; animation-delay: -6s; }
          @keyframes float { 0% { transform: translateY(0px) scale(1); } 100% { transform: translateY(40px) scale(1.1); } }
          .glass-panel { background: rgba(20, 20, 25, 0.5); backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%); border-radius: 20px; border-top: 1px solid rgba(255, 255, 255, 0.15); border-left: 1px solid rgba(255, 255, 255, 0.1); border-right: 1px solid rgba(255, 255, 255, 0.05); border-bottom: 1px solid rgba(255, 255, 255, 0.05); box-shadow: 0 30px 60px rgba(0, 0, 0, 0.6), inset 0 0 0 1px rgba(255, 255, 255, 0.05); overflow: hidden; }
          .input-3d { flex: 1; background: rgba(0, 0, 0, 0.3); border: none; outline: none; font-size: 14px; color: #e2e8f0; padding: 12px 14px; border-radius: 10px; box-shadow: inset 0 3px 6px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.08); transition: all 0.2s; width: 100%; }
          .input-3d:focus { background: rgba(0, 0, 0, 0.5); box-shadow: inset 0 3px 6px rgba(0,0,0,0.8), 0 0 0 2px rgba(59, 130, 246, 0.5); }
          .btn-ai { padding: 12px 24px; border: none; border-radius: 30px; font-weight: 700; font-size: 14px; cursor: pointer; transition: all 0.15s ease; transform: translateY(-4px); white-space: nowrap; color: #fff; background: linear-gradient(135deg, #3b82f6 0%, #a855f7 100%); box-shadow: 0 6px 0 #2563eb, 0 15px 30px rgba(59, 130, 246, 0.4); }
          .btn-ai:active { transform: translateY(2px); box-shadow: 0 0 0 #2563eb, 0 5px 15px rgba(59, 130, 246, 0.4); }
        `}</style>
        
        <div className="ambient-orb orb-1"></div>
        <div className="ambient-orb orb-2"></div>
        
        <div className="glass-panel" style={{ padding: '40px', width: '100%', maxWidth: '380px', textAlign: 'center', zIndex: 10 }}>
          <div style={{ fontSize: '40px', marginBottom: '10px' }}>🔐</div>
          <h2 style={{ color: '#fff', margin: '0 0 24px 0', fontSize: '20px', letterSpacing: '1px' }}>SYSTEM ACCESS</h2>
          
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <input type="text" placeholder="Admin Username" className="input-3d" value={authUsername} onChange={(e) => setAuthUsername(e.target.value)} required />
            <input type="password" placeholder="Encryption Key" className="input-3d" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} required />
            {authError && <div style={{ color: '#ef4444', fontSize: '12px', fontWeight: 'bold' }}>{authError}</div>}
            <button type="submit" disabled={isLoggingIn} className="btn-ai" style={{ marginTop: '10px' }}>
              {isLoggingIn ? 'Decrypting...' : 'INITIALIZE'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- DASHBOARD RENDER ---
  return (
    <div className="app-container">
      <style>{`
        * { box-sizing: border-box; }
        .app-container { min-height: 100vh; background: #050505; padding: 30px 20px 10px 20px; font-family: 'Inter', system-ui, sans-serif; position: relative; overflow-x: hidden; z-index: 1; display: flex; flex-direction: column; }
        .dashboard-grid { display: grid; grid-template-columns: minmax(200px, 260px) minmax(400px, 1fr) minmax(200px, 260px); gap: 20px; max-width: 1400px; width: 100%; margin: 0 auto; position: relative; z-index: 10; flex: 1; }
        @media (max-width: 1050px) { .dashboard-grid { grid-template-columns: 1fr; max-width: 800px; } .side-panel { display: none !important; } }
        .ambient-orb { position: absolute; border-radius: 50%; filter: blur(90px); z-index: -1; animation: float 12s infinite ease-in-out alternate; }
        .orb-1 { width: 40vw; height: 40vw; background: rgba(59, 130, 246, 0.25); top: -10%; left: 5%; }
        .orb-2 { width: 50vw; height: 50vw; background: rgba(168, 85, 247, 0.2); bottom: -10%; right: -5%; animation-delay: -6s; }
        .orb-3 { width: 30vw; height: 30vw; background: rgba(16, 185, 129, 0.15); top: 30%; left: 35%; animation-delay: -3s; }
        @keyframes float { 0% { transform: translateY(0px) scale(1); } 100% { transform: translateY(40px) scale(1.1); } }
        .glass-panel { background: rgba(20, 20, 25, 0.5); backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%); border-radius: 20px; border-top: 1px solid rgba(255, 255, 255, 0.15); border-left: 1px solid rgba(255, 255, 255, 0.1); border-right: 1px solid rgba(255, 255, 255, 0.05); border-bottom: 1px solid rgba(255, 255, 255, 0.05); box-shadow: 0 30px 60px rgba(0, 0, 0, 0.6), inset 0 0 0 1px rgba(255, 255, 255, 0.05); overflow: hidden; }
        .input-3d { flex: 1; background: rgba(0, 0, 0, 0.3); border: none; outline: none; font-size: 14px; color: #e2e8f0; padding: 12px 14px; border-radius: 10px; box-shadow: inset 0 3px 6px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.08); transition: all 0.2s; width: 100%; }
        .input-3d:focus { background: rgba(0, 0, 0, 0.5); box-shadow: inset 0 3px 6px rgba(0,0,0,0.8), 0 0 0 2px rgba(59, 130, 246, 0.5); }
        .btn-3d, .btn-ai { padding: 12px 24px; border: none; border-radius: 30px; font-weight: 700; font-size: 14px; cursor: pointer; transition: all 0.15s ease; transform: translateY(-4px); white-space: nowrap; }
        .btn-3d { color: #0f172a; background: #f8fafc; box-shadow: 0 6px 0 #94a3b8, 0 15px 25px rgba(0,0,0,0.4); }
        .btn-3d:active { transform: translateY(2px); box-shadow: 0 0 0 #94a3b8, 0 5px 10px rgba(0,0,0,0.4); }
        .btn-3d:disabled { opacity: 0.7; cursor: not-allowed; }
        .btn-ai { color: #fff; background: linear-gradient(135deg, #a855f7 0%, #ec4899 100%); box-shadow: 0 6px 0 #7e22ce, 0 15px 30px rgba(236, 72, 153, 0.4); }
        .btn-ai:active { transform: translateY(2px); box-shadow: 0 0 0 #7e22ce, 0 5px 15px rgba(236, 72, 153, 0.4); }
        .side-panel { display: flex; flex-direction: column; gap: 20px; height: fit-content; }
        .side-module { background: rgba(0,0,0,0.2); border-radius: 16px; padding: 18px; box-shadow: inset 0 2px 5px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.03); }
        .module-title { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 800; margin-bottom: 14px; display: flex; alignItems: center; gap: 8px;}
        .template-btn { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); color: #cbd5e1; padding: 10px 12px; border-radius: 10px; font-size: 12px; text-align: left; cursor: pointer; transition: all 0.2s; margin-bottom: 8px; width: 100%; font-weight: 500; }
        .template-btn:hover { background: rgba(255,255,255,0.08); transform: translateX(4px); border-color: rgba(255,255,255,0.15); }
        .tone-btn { flex: 1; padding: 10px 0; text-align: center; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; border: 1px solid transparent; transition: all 0.2s; }
        .tone-active { background: rgba(59, 130, 246, 0.2); border-color: rgba(59, 130, 246, 0.5); color: #60a5fa; box-shadow: 0 0 15px rgba(59, 130, 246, 0.2); }
        .tone-inactive { background: rgba(0,0,0,0.4); color: #64748b; border-color: rgba(255,255,255,0.05); }
        .quill { background: rgba(0, 0, 0, 0.3); border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); overflow: hidden; }
        .ql-toolbar { background: rgba(0, 0, 0, 0.5) !important; border: none !important; border-bottom: 1px solid rgba(255,255,255,0.08) !important; }
        .ql-container { border: none !important; color: #e2e8f0 !important; font-size: 14px !important; min-height: 240px; }
        .ql-editor { padding: 20px; }
        .ql-stroke { stroke: #94a3b8 !important; }
        .ql-fill { fill: #94a3b8 !important; }
        .ql-picker-label, .ql-picker-item { color: #94a3b8 !important; }
        .watermark { text-align: center; margin-top: 40px; padding-bottom: 10px; font-size: 11px; color: rgba(148, 163, 184, 0.4); letter-spacing: 3px; text-transform: uppercase; font-weight: 700; position: relative; z-index: 10; }
        .watermark span { color: rgba(59, 130, 246, 0.6); }
      `}</style>

      <div className="ambient-orb orb-1"></div>
      <div className="ambient-orb orb-2"></div>
      <div className="ambient-orb orb-3"></div>

      <div className="dashboard-grid">
        
        {/* LEFT PANEL */}
        <div className="side-panel">
          <div className="glass-panel side-module">
            <div className="module-title">📒 Client CRM</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
              <input type="text" placeholder="Client Name" className="input-3d" style={{ padding: '10px', fontSize: '12px' }} value={newContactName} onChange={e => setNewContactName(e.target.value)} />
              <input type="email" placeholder="client@domain.com" className="input-3d" style={{ padding: '10px', fontSize: '12px' }} value={newContactEmail} onChange={e => setNewContactEmail(e.target.value)} />
              <button type="button" onClick={addContact} style={{ padding: '10px', background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.4)', borderRadius: '10px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', transition: 'all 0.2s' }}>
                + Save Contact
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto', paddingRight: '4px' }}>
              {contacts.map((c, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)', transition: 'background 0.2s' }}>
                  <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => {setMode('single'); setToEmail(c.email);}}>
                    <div style={{ fontSize: '12px', color: '#e2e8f0', fontWeight: '700' }}>{c.name}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>{c.email}</div>
                  </div>
                  <button type="button" onClick={() => removeContact(i)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '16px', padding: '0 4px', opacity: 0.7 }}>×</button>
                </div>
              ))}
              {contacts.length === 0 && <div style={{ fontSize: '11px', color: '#64748b', textAlign: 'center', padding: '10px' }}>No saved clients.</div>}
            </div>
          </div>

          <div className="glass-panel side-module">
            <div className="module-title">⚡ Quick Templates</div>
            <button className="template-btn" onClick={() => applyTemplate("<p>Following up on our previous conversation regarding...</p>")}>🤝 Standard Follow Up</button>
            <button className="template-btn" onClick={() => applyTemplate("<p>Please accept my sincere apologies for the delay in...</p>")}>🛡️ Professional Apology</button>
            <button className="template-btn" onClick={() => applyTemplate("<p>Hi {Name},</p><p>I'm reaching out to introduce our new services...</p>")}>🚀 Cold Outreach</button>
            <button className="template-btn" onClick={() => applyTemplate("<p>Just a quick reminder that your invoice is due on...</p>")}>📅 Payment Reminder</button>
          </div>
        </div>

        {/* CENTER PANEL */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className="glass-panel">
            <div style={{ background: 'rgba(0, 0, 0, 0.2)', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <h3 style={{ margin: 0, color: '#fff', fontSize: '16px', fontWeight: '600' }}>Transmitter</h3>
              <div style={{ display: 'flex', background: 'rgba(0,0,0,0.5)', padding: '4px', borderRadius: '30px', boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.5)' }}>
                <button type="button" onClick={() => setMode('single')} style={{ padding: '6px 16px', border: 'none', borderRadius: '24px', background: mode === 'single' ? 'linear-gradient(180deg, #3b82f6, #2563eb)' : 'transparent', color: mode === 'single' ? '#fff' : '#64748b', cursor: 'pointer', fontSize: '12px', fontWeight: '700', transition: 'all 0.2s ease', boxShadow: mode === 'single' ? '0 4px 10px rgba(37, 99, 235, 0.4)' : 'none' }}>Single</button>
                <button type="button" onClick={() => setMode('bulk')} style={{ padding: '6px 16px', border: 'none', borderRadius: '24px', background: mode === 'bulk' ? 'linear-gradient(180deg, #3b82f6, #2563eb)' : 'transparent', color: mode === 'bulk' ? '#fff' : '#64748b', cursor: 'pointer', fontSize: '12px', fontWeight: '700', transition: 'all 0.2s ease', boxShadow: mode === 'bulk' ? '0 4px 10px rgba(37, 99, 235, 0.4)' : 'none' }}>Bulk CSV</button>
              </div>
            </div>

            <form onSubmit={handleSend}>
              <div style={{ display: 'flex', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ width: '80px', color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>{mode === 'single' ? 'To' : 'CSV'}</span>
                {mode === 'single' ? (
                  <input type="email" placeholder="recipient@domain.com (Click a CRM contact to auto-fill)" value={toEmail} onChange={e => setToEmail(e.target.value)} required className="input-3d"/>
                ) : (
                  <input type="file" accept=".csv" onChange={e => setFile(e.target.files[0])} ref={fileInputRef} required className="input-3d" style={{ color: '#94a3b8' }}/>
                )}
              </div>
              
              {mode === 'single' && (
                <div style={{ display: 'flex', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ width: '80px', color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>Cc</span>
                  <input type="email" placeholder="carbon.copy@domain.com" value={ccEmail} onChange={e => setCcEmail(e.target.value)} className="input-3d"/>
                </div>
              )}
              
              <div style={{ display: 'flex', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)', position: 'relative' }}>
                <span style={{ width: '80px', color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>Subject</span>
                <input type="text" placeholder="Enter subject line..." value={subject} onChange={e => setSubject(e.target.value)} required className="input-3d" style={{ fontWeight: '600', color: '#fff', paddingRight: '40px' }}/>
                <button type="button" onClick={handleAISubject} disabled={isDraftingSubject} title="Generate Subject with AI" style={{ position: 'absolute', right: '28px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '16px', opacity: isDraftingSubject ? 0.5 : 1, transition: 'transform 0.2s' }} onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.2)'} onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
                  ✨
                </button>
              </div>

              <div style={{ padding: '20px' }}>
                <ReactQuill 
                  theme="snow" 
                  value={msg} 
                  onChange={setMsg} 
                  placeholder={mode === 'bulk' ? "Draft your campaign here. Use {ColumnName} to insert ANY variable dynamically from your CSV..." : "Type your core message here, then click Smart AI Draft..."}
                />
              </div>

              <div style={{ padding: '20px', display: 'flex', gap: '16px', alignItems: 'center', background: 'rgba(0,0,0,0.3)', borderTop: '1px solid rgba(255,255,255,0.05)', borderBottomLeftRadius: '20px', borderBottomRightRadius: '20px' }}>
                 <button type="submit" disabled={isSending} className="btn-3d">{isSending ? 'Transmitting...' : 'Dispatch'}</button>
                 <button type="button" onClick={handleSmartDraft} disabled={isDrafting} className="btn-ai">{isDrafting ? '✨ Processing...' : '✨ Smart AI Draft'}</button>
              </div>
            </form>
          </div>

          <div className="glass-panel" style={{ padding: '20px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1.5px', color: '#94a3b8', fontWeight: '700' }}>Transmission Log</h3>
            <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '10px', overflow: 'hidden', boxShadow: 'inset 0 3px 6px rgba(0,0,0,0.4)', overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: '400px', textAlign: 'left', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
                    <th style={{ padding: '12px', color: '#64748b', fontWeight: '700', fontSize: '11px', textTransform: 'uppercase' }}>Time</th>
                    <th style={{ padding: '12px', color: '#64748b', fontWeight: '700', fontSize: '11px', textTransform: 'uppercase' }}>Recipient</th>
                    <th style={{ padding: '12px', color: '#64748b', fontWeight: '700', fontSize: '11px', textTransform: 'uppercase' }}>Subject</th>
                    <th style={{ padding: '12px', color: '#64748b', fontWeight: '700', fontSize: '11px', textTransform: 'uppercase' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                      <td style={{ padding: '12px', fontSize: '12px', color: '#94a3b8' }}>{new Date(log.timestamp).toLocaleTimeString()}</td>
                      <td style={{ padding: '12px', fontSize: '13px', color: '#e2e8f0' }}>{log.recipient}</td>
                      <td style={{ padding: '12px', fontSize: '13px', color: '#cbd5e1' }}>{log.subject}</td>
                      <td style={{ padding: '12px', fontSize: '13px', fontWeight: '700', color: log.status.includes('Success') ? '#10b981' : '#ef4444' }}>{log.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {logs.length === 0 && <p style={{ textAlign: 'center', color: '#475569', padding: '20px', margin: 0, fontSize: '13px' }}>Awaiting initial transmission.</p>}
            </div>
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div className="side-panel">
          <div className="glass-panel side-module">
            <div className="module-title">🧠 AI Persona Settings</div>
            <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: 0, marginBottom: '14px', lineHeight: '1.4' }}>
              Select the behavioral tone the AI should use before drafting.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className={`tone-btn ${aiTone === 'Professional' ? 'tone-active' : 'tone-inactive'}`} onClick={() => setAiTone('Professional')}>👔 Professional</div>
              <div className={`tone-btn ${aiTone === 'Friendly' ? 'tone-active' : 'tone-inactive'}`} onClick={() => setAiTone('Friendly')}>😊 Friendly & Warm</div>
              <div className={`tone-btn ${aiTone === 'Urgent' ? 'tone-active' : 'tone-inactive'}`} onClick={() => setAiTone('Urgent')}>⚠️ Urgent & Direct</div>
              <div className={`tone-btn ${aiTone === 'Persuasive' ? 'tone-active' : 'tone-inactive'}`} onClick={() => setAiTone('Persuasive')}>🚀 Sales / Persuasive</div>
            </div>
          </div>

          <div className="glass-panel side-module">
            <div className="module-title">📊 Live Analytics</div>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '14px', borderRadius: '12px', marginBottom: '10px', border: '1px solid rgba(255,255,255,0.03)' }}>
              <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '1px' }}>Total Dispatched</div>
              <div style={{ fontSize: '28px', fontWeight: '800', color: '#fff' }}>{totalSent}</div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.03)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '8px' }}>
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '1px' }}>Success Rate</div>
                <div style={{ fontSize: '18px', fontWeight: '800', color: '#10b981' }}>{successRate}%</div>
              </div>
              <div style={{ width: '100%', height: '6px', background: 'rgba(0,0,0,0.5)', borderRadius: '10px', overflow: 'hidden', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)' }}>
                <div style={{ width: `${successRate}%`, height: '100%', background: 'linear-gradient(90deg, #10b981, #34d399)', boxShadow: '0 0 10px rgba(16, 185, 129, 0.6)', transition: 'width 0.5s ease' }}></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* WATERMARK & LOGOUT */}
      <div className="watermark">
        System Architect: <span>Bijoy Roy</span>
        <div style={{ marginTop: '16px' }}>
          <button 
            onClick={handleLogout} 
            style={{ background: 'transparent', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#ef4444', padding: '8px 16px', borderRadius: '20px', cursor: 'pointer', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: '700', transition: 'all 0.2s' }} 
            onMouseEnter={e => e.target.style.background = 'rgba(239, 68, 68, 0.1)'} 
            onMouseLeave={e => e.target.style.background = 'transparent'}
          >
            🔒 System Logout
          </button>
        </div>
      </div>
    </div>
  );
}