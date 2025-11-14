
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Type, FunctionDeclaration, LiveSession, LiveServerMessage, Modality, Blob } from "@google/genai";
import { Note, Todo, CalendarEvent, VoiceNote, ActiveView } from '../types';
import { NoteIcon, MicIcon, TodoIcon, CalendarIcon, SaveIcon, SpinnerIcon, LogoutIcon, TrashIcon, StopIcon, PlusIcon, BellIcon } from './icons';

// --- Gemini Live API Audio Helper Functions ---
function encode(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function createBlob(data: Float32Array): Blob {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        int16[i] = data[i] * 32768;
    }
    return {
        data: encode(new Uint8Array(int16.buffer)),
        mimeType: 'audio/pcm;rate=16000',
    };
}


const Dashboard: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
    const [user, setUser] = useState<{ name: string; email: string } | null>(null);
    const [activeView, setActiveView] = useState<ActiveView>('notes');
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');
    
    // Data states
    const [notes, setNotes] = useState<Note[]>([]);
    const [currentNote, setCurrentNote] = useState('');
    const [todos, setTodos] = useState<Todo[]>([]);
    const [newTodo, setNewTodo] = useState('');
    const [newTodoReminder, setNewTodoReminder] = useState('');
    const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
    const [eventInput, setEventInput] = useState('');
    const [eventReminderMinutes, setEventReminderMinutes] = useState<number | null>(15);
    const [isScheduling, setIsScheduling] = useState(false);
    const [voiceNotes, setVoiceNotes] = useState<VoiceNote[]>([]);

    // Voice note recording states
    const [isRecording, setIsRecording] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [transcription, setTranscription] = useState('');
    const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);

    // Notification state
    const [notificationPermission, setNotificationPermission] = useState(Notification.permission);


    // Load data from localStorage on mount
    useEffect(() => {
        try {
            const storedUser = localStorage.getItem('user');
            if(storedUser) setUser(JSON.parse(storedUser));
            
            const storedNotes = localStorage.getItem('iwa-notes');
            if(storedNotes) setNotes(JSON.parse(storedNotes).map((n: any) => ({...n, createdAt: new Date(n.createdAt)})));

            const storedTodos = localStorage.getItem('iwa-todos');
            if(storedTodos) setTodos(JSON.parse(storedTodos));

            const storedEvents = localStorage.getItem('iwa-events');
            if(storedEvents) setCalendarEvents(JSON.parse(storedEvents));

            const storedVoiceNotes = localStorage.getItem('iwa-voicenotes');
            if(storedVoiceNotes) setVoiceNotes(JSON.parse(storedVoiceNotes).map((n: any) => ({...n, createdAt: new Date(n.createdAt)})));

        } catch (error) {
            console.error("Failed to parse data from localStorage", error);
        }
        
        // Request notification permission
        if (Notification.permission === 'default') {
            Notification.requestPermission().then(setNotificationPermission);
        }
    }, []);

    // --- Reminder and Notification Logic ---
    useEffect(() => {
        if (notificationPermission !== 'granted') return;

        const checkReminders = () => {
            const now = new Date();

            // Check To-Do Reminders
            setTodos(prevTodos => {
                let needsUpdate = false;
                const newTodos = prevTodos.map(todo => {
                    if (todo.reminder && !todo.completed && !todo.notified && new Date(todo.reminder) <= now) {
                        new Notification('IWA Note Reminder', {
                            body: `Don't forget: ${todo.text}`,
                        });
                        needsUpdate = true;
                        return { ...todo, notified: true };
                    }
                    return todo;
                });
                return needsUpdate ? newTodos : prevTodos;
            });

            // Check Calendar Event Alarms
            setCalendarEvents(prevEvents => {
                let needsUpdate = false;
                const newEvents = prevEvents.map(event => {
                    if (event.reminder !== undefined && event.reminder !== null && !event.notified) {
                        try {
                            const eventDateTime = new Date(`${event.date}T${event.time}`);
                            const reminderTime = new Date(eventDateTime.getTime() - event.reminder * 60000);
                            if (reminderTime <= now) {
                                new Notification('IWA Note: Upcoming Event', {
                                    body: `${event.title} starts in ${event.reminder} minutes.`,
                                });
                                needsUpdate = true;
                                return { ...event, notified: true };
                            }
                        } catch (e) {
                            console.error("Error parsing event date for reminder", e);
                        }
                    }
                    return event;
                });
                return needsUpdate ? newEvents : prevEvents;
            });
        };

        const intervalId = setInterval(checkReminders, 30000); // Check every 30 seconds
        return () => clearInterval(intervalId);
    }, [notificationPermission]);

    const saveDataToCloud = () => {
        setIsSaving(true);
        setSaveMessage('');
        try {
            localStorage.setItem('iwa-notes', JSON.stringify(notes));
            localStorage.setItem('iwa-todos', JSON.stringify(todos));
            localStorage.setItem('iwa-events', JSON.stringify(calendarEvents));
            localStorage.setItem('iwa-voicenotes', JSON.stringify(voiceNotes));
            setTimeout(() => {
                setSaveMessage('Successfully saved to cloud drive!');
                setIsSaving(false);
                setTimeout(() => setSaveMessage(''), 2000);
            }, 1500);
        } catch (error) {
            console.error("Failed to save data", error);
            setSaveMessage('Error saving data.');
            setIsSaving(false);
        }
    };
    
    // --- Notes Logic ---
    const handleSaveNote = () => {
        if (currentNote.trim()) {
            const newNote: Note = { id: Date.now().toString(), content: currentNote.trim(), createdAt: new Date() };
            setNotes(prev => [newNote, ...prev]);
            setCurrentNote('');
        }
    };
     const handleDeleteNote = (id: string) => {
        setNotes(notes.filter(note => note.id !== id));
    };

    // --- To-Do Logic ---
    const handleAddTodo = () => {
        if (newTodo.trim()) {
            const newTodoItem: Todo = { 
                id: Date.now().toString(), 
                text: newTodo.trim(), 
                completed: false,
                 ...(newTodoReminder && { reminder: newTodoReminder, notified: false })
            };
            setTodos(prev => [...prev, newTodoItem]);
            setNewTodo('');
            setNewTodoReminder('');
        }
    };
    const toggleTodo = (id: string) => {
        setTodos(todos.map(todo => todo.id === id ? { ...todo, completed: !todo.completed } : todo));
    };
     const handleDeleteTodo = (id: string) => {
        setTodos(todos.filter(todo => todo.id !== id));
    };


    // --- Calendar Logic (Gemini Function Calling) ---
    const handleScheduleEvent = async () => {
        if (!eventInput.trim()) return;
        setIsScheduling(true);

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const createEventFunctionDeclaration: FunctionDeclaration = {
                name: 'create_calendar_event',
                parameters: {
                    type: Type.OBJECT,
                    description: 'Creates a calendar event with details extracted from user input.',
                    properties: {
                        title: { type: Type.STRING, description: 'The title of the event.' },
                        date: { type: Type.STRING, description: 'The date of the event in YYYY-MM-DD format.' },
                        time: { type: Type.STRING, description: 'The time of the event in HH:MM format (24-hour clock).' },
                        attendees: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'List of attendee names or emails.' },
                        description: { type: Type.STRING, description: 'A brief description of the event.' },
                    },
                    required: ['title', 'date', 'time'],
                },
            };
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `Create a calendar event based on this: "${eventInput}"`,
                config: {
                    tools: [{ functionDeclarations: [createEventFunctionDeclaration] }],
                },
            });

            const functionCall = response.functionCalls?.[0];
            if (functionCall && functionCall.name === 'create_calendar_event') {
                const { title, date, time, attendees, description } = functionCall.args;
                const newEvent: CalendarEvent = { 
                    id: Date.now().toString(), 
                    title, 
                    date, 
                    time, 
                    attendees, 
                    description,
                    ...(eventReminderMinutes !== null && { reminder: eventReminderMinutes, notified: false })
                };
                setCalendarEvents(prev => [newEvent, ...prev]);
                setEventInput('');
            } else {
                 alert("I couldn't understand the event details. Please try being more specific.");
            }
        } catch (error) {
            console.error('Error scheduling event:', error);
            alert('An error occurred while scheduling the event.');
        } finally {
            setIsScheduling(false);
        }
    };
    const handleDeleteEvent = (id: string) => {
        setCalendarEvents(calendarEvents.filter(event => event.id !== id));
    };
    
    // --- Voice Note Logic (Gemini Live API) ---
    const stopRecording = useCallback(async () => {
        setIsRecording(false);
        setIsConnecting(false);
        
        if (sessionPromiseRef.current) {
            const session = await sessionPromiseRef.current;
            session.close();
            sessionPromiseRef.current = null;
        }
        
        streamRef.current?.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        
        scriptProcessorRef.current?.disconnect();
        scriptProcessorRef.current = null;

        inputAudioContextRef.current?.close();
        inputAudioContextRef.current = null;

        if (transcription.trim()) {
            const newVoiceNote: VoiceNote = { id: Date.now().toString(), transcription, createdAt: new Date() };
            setVoiceNotes(prev => [newVoiceNote, ...prev]);
        }
        setTranscription('');
    }, [transcription]);

    const startRecording = useCallback(async () => {
        setTranscription('');
        setIsConnecting(true);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            
            inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            sessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: () => {
                        setIsConnecting(false);
                        setIsRecording(true);
                        
                        const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
                        const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
                        scriptProcessorRef.current = scriptProcessor;

                        scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob = createBlob(inputData);
                            sessionPromiseRef.current?.then((session) => {
                                session.sendRealtimeInput({ media: pcmBlob });
                            });
                        };
                        source.connect(scriptProcessor);
                        scriptProcessor.connect(inputAudioContextRef.current!.destination);
                    },
                    onmessage: (message: LiveServerMessage) => {
                        if (message.serverContent?.inputTranscription) {
                            const text = message.serverContent.inputTranscription.text;
                            setTranscription(prev => prev + text);
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('Live session error:', e);
                        stopRecording();
                    },
                    onclose: (e: CloseEvent) => {
                         console.log('Live session closed');
                    },
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                },
            });
        } catch (error) {
            console.error('Failed to start recording:', error);
            alert('Could not start recording. Please ensure microphone permissions are granted.');
            setIsConnecting(false);
        }
    }, [stopRecording]);

    useEffect(() => {
        return () => {
            if (isRecording) {
                stopRecording();
            }
        };
    }, [isRecording, stopRecording]);

    const handleDeleteVoiceNote = (id: string) => {
        setVoiceNotes(voiceNotes.filter(note => note.id !== id));
    };


    const renderContent = () => {
        switch (activeView) {
            case 'notes':
                return (
                    <div className="flex flex-col md:flex-row gap-6 h-full">
                        <div className="md:w-1/2 flex flex-col">
                            <h3 className="text-xl font-semibold mb-3 text-indigo-300">New Note</h3>
                            <textarea
                                value={currentNote}
                                onChange={(e) => setCurrentNote(e.target.value)}
                                placeholder="Start typing your meeting notes..."
                                className="w-full flex-grow p-4 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none"
                            ></textarea>
                            <button onClick={handleSaveNote} className="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">Save Note</button>
                        </div>
                        <div className="md:w-1/2 flex flex-col">
                            <h3 className="text-xl font-semibold mb-3 text-indigo-300">Saved Notes</h3>
                            <div className="space-y-3 overflow-y-auto pr-2">
                                {notes.map(note => (
                                    <div key={note.id} className="bg-slate-800 p-4 rounded-lg border border-slate-700 relative group">
                                        <p className="text-slate-300 whitespace-pre-wrap">{note.content}</p>
                                        <p className="text-xs text-slate-500 mt-2">{note.createdAt.toLocaleString()}</p>
                                        <button onClick={() => handleDeleteNote(note.id)} className="absolute top-2 right-2 p-1 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <TrashIcon className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            case 'voice':
                 return (
                    <div className="flex flex-col md:flex-row gap-6 h-full">
                        <div className="md:w-1/2 flex flex-col items-center justify-center bg-slate-800 p-6 rounded-lg border border-slate-700">
                             <h3 className="text-xl font-semibold mb-4 text-indigo-300">Voice Memo & Transcription</h3>
                             <button 
                                onClick={isRecording ? stopRecording : startRecording}
                                disabled={isConnecting}
                                className={`w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 focus:outline-none focus:ring-4 ${
                                    isRecording ? 'bg-red-500 hover:bg-red-600 ring-red-400' : 'bg-indigo-600 hover:bg-indigo-700 ring-indigo-500'
                                }`}
                            >
                                {isConnecting ? <SpinnerIcon className="w-10 h-10 text-white" /> : isRecording ? <StopIcon className="w-10 h-10 text-white"/> : <MicIcon className="w-10 h-10 text-white"/>}
                            </button>
                             <p className="mt-4 text-slate-400 h-6">{isConnecting ? 'Connecting...' : isRecording ? 'Recording...' : 'Tap to start recording'}</p>
                             <div className="w-full h-40 mt-4 bg-slate-900 p-3 rounded-md overflow-y-auto border border-slate-700">
                                <p className="text-slate-300 whitespace-pre-wrap">{transcription}</p>
                             </div>
                        </div>
                        <div className="md:w-1/2 flex flex-col">
                            <h3 className="text-xl font-semibold mb-3 text-indigo-300">Saved Voice Notes</h3>
                            <div className="space-y-3 overflow-y-auto pr-2">
                                {voiceNotes.map(note => (
                                    <div key={note.id} className="bg-slate-800 p-4 rounded-lg border border-slate-700 relative group">
                                        <p className="text-slate-300">{note.transcription}</p>
                                        <p className="text-xs text-slate-500 mt-2">{note.createdAt.toLocaleString()}</p>
                                        <button onClick={() => handleDeleteVoiceNote(note.id)} className="absolute top-2 right-2 p-1 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <TrashIcon className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            case 'todos':
                return (
                    <div className="flex flex-col h-full">
                        <h3 className="text-xl font-semibold mb-3 text-indigo-300">To-Do List</h3>
                        <div className="flex flex-col sm:flex-row gap-2 mb-4">
                            <input
                                type="text"
                                value={newTodo}
                                onChange={(e) => setNewTodo(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && handleAddTodo()}
                                placeholder="Add a new to-do item..."
                                className="w-full p-2 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            />
                            <input
                                type="datetime-local"
                                value={newTodoReminder}
                                onChange={(e) => setNewTodoReminder(e.target.value)}
                                title="Set a reminder"
                                className="p-2 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-slate-400"
                            />
                            <button onClick={handleAddTodo} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold p-2 rounded-lg transition-colors flex items-center justify-center">
                                <PlusIcon className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="space-y-3 overflow-y-auto pr-2 flex-grow">
                            {todos.map(todo => (
                                <div key={todo.id} className="flex items-center bg-slate-800 p-3 rounded-lg border border-slate-700 group">
                                    <input type="checkbox" checked={todo.completed} onChange={() => toggleTodo(todo.id)} className="h-5 w-5 rounded bg-slate-700 border-slate-600 text-indigo-600 focus:ring-indigo-500" />
                                    <div className="ml-3 flex-grow">
                                        <span className={`text-slate-300 ${todo.completed ? 'line-through text-slate-500' : ''}`}>{todo.text}</span>
                                        {todo.reminder && !todo.completed && (
                                            <div className="flex items-center text-xs text-amber-400 mt-1">
                                                <BellIcon className="w-3 h-3 mr-1"/>
                                                <span>{new Date(todo.reminder).toLocaleString()}</span>
                                            </div>
                                        )}
                                    </div>
                                    <button onClick={() => handleDeleteTodo(todo.id)} className="ml-4 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <TrashIcon className="w-5 h-5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            case 'calendar':
                return (
                     <div className="flex flex-col md:flex-row gap-6 h-full">
                        <div className="md:w-1/2 flex flex-col">
                            <h3 className="text-xl font-semibold mb-3 text-indigo-300">Schedule Event</h3>
                            <p className="text-sm text-slate-400 mb-2">Describe the event in natural language. E.g., "Schedule a marketing sync with Jane and Alex for tomorrow at 3pm to discuss Q3 results."</p>
                            <textarea
                                value={eventInput}
                                onChange={(e) => setEventInput(e.target.value)}
                                placeholder="Describe your event..."
                                className="w-full h-32 p-4 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none"
                            ></textarea>
                            <div className="flex items-center mt-4 gap-4">
                                <select 
                                    value={eventReminderMinutes ?? ''} 
                                    onChange={e => setEventReminderMinutes(e.target.value ? Number(e.target.value) : null)}
                                    className="w-full p-2 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                >
                                    <option value="">No reminder</option>
                                    <option value="5">5 minutes before</option>
                                    <option value="15">15 minutes before</option>
                                    <option value="30">30 minutes before</option>
                                    <option value="60">1 hour before</option>
                                </select>
                                <button onClick={handleScheduleEvent} disabled={isScheduling} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg transition-colors flex items-center justify-center disabled:bg-slate-600">
                                    {isScheduling ? <SpinnerIcon className="w-5 h-5 mr-2" /> : null}
                                    {isScheduling ? 'Scheduling...' : 'Schedule with AI'}
                                </button>
                            </div>
                        </div>
                        <div className="md:w-1/2 flex flex-col">
                             <h3 className="text-xl font-semibold mb-3 text-indigo-300">Upcoming Events</h3>
                             <div className="space-y-3 overflow-y-auto pr-2">
                                {calendarEvents.map(event => (
                                    <div key={event.id} className="bg-slate-800 p-4 rounded-lg border border-slate-700 relative group">
                                        <h4 className="font-bold text-indigo-400">{event.title}</h4>
                                        <p className="text-slate-300">{event.date} at {event.time}</p>
                                        {event.description && <p className="text-sm text-slate-400 mt-1">{event.description}</p>}
                                        {event.attendees && <p className="text-sm text-slate-400 mt-1">Attendees: {event.attendees.join(', ')}</p>}
                                        {event.reminder !== undefined && event.reminder !== null && (
                                            <p className="text-sm text-slate-400 mt-1 flex items-center">
                                                <BellIcon className="w-4 h-4 mr-1 text-amber-400"/>
                                                <span>Reminder: {event.reminder} minutes before</span>
                                            </p>
                                        )}
                                         <button onClick={() => handleDeleteEvent(event.id)} className="absolute top-2 right-2 p-1 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <TrashIcon className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            default: return null;
        }
    };
    
    return (
        <div className="flex h-screen bg-slate-900 text-white">
            {/* Sidebar */}
            <nav className="w-20 bg-slate-800 p-4 flex flex-col items-center justify-between border-r border-slate-700">
                <div>
                     <div className="flex items-center mb-10">
                        <NoteIcon className="h-8 w-8 text-indigo-400" />
                    </div>
                    <div className="space-y-6">
                        <button onClick={() => setActiveView('notes')} className={`p-3 rounded-lg transition-colors ${activeView === 'notes' ? 'bg-indigo-600' : 'hover:bg-slate-700'}`}><NoteIcon className="h-6 w-6" /></button>
                        <button onClick={() => setActiveView('voice')} className={`p-3 rounded-lg transition-colors ${activeView === 'voice' ? 'bg-indigo-600' : 'hover:bg-slate-700'}`}><MicIcon className="h-6 w-6" /></button>
                        <button onClick={() => setActiveView('todos')} className={`p-3 rounded-lg transition-colors ${activeView === 'todos' ? 'bg-indigo-600' : 'hover:bg-slate-700'}`}><TodoIcon className="h-6 w-6" /></button>
                        <button onClick={() => setActiveView('calendar')} className={`p-3 rounded-lg transition-colors ${activeView === 'calendar' ? 'bg-indigo-600' : 'hover:bg-slate-700'}`}><CalendarIcon className="h-6 w-6" /></button>
                    </div>
                </div>
                <div>
                     <button onClick={onLogout} className="p-3 rounded-lg hover:bg-slate-700 transition-colors">
                        <LogoutIcon className="h-6 w-6 text-slate-400" />
                    </button>
                </div>
            </nav>
            {/* Main Content */}
            <main className="flex-1 flex flex-col">
                {/* Header */}
                <header className="flex justify-between items-center p-4 bg-slate-800 border-b border-slate-700">
                     <div>
                        <h2 className="text-2xl font-bold text-slate-200">Welcome, {user?.name.split(' ')[0] || 'User'}!</h2>
                        <p className="text-sm text-slate-400">IWA Note Dashboard</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="text-sm text-green-400 h-5">{saveMessage}</span>
                        <button onClick={saveDataToCloud} disabled={isSaving} className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-2 px-4 rounded-lg transition-colors disabled:opacity-50">
                            {isSaving ? <SpinnerIcon className="w-5 h-5"/> : <SaveIcon className="w-5 h-5"/>}
                            {isSaving ? 'Saving...' : 'Save to Cloud'}
                        </button>
                    </div>
                </header>
                {/* Content Area */}
                <div className="flex-1 p-6 overflow-hidden">
                    {renderContent()}
                </div>
            </main>
        </div>
    );
};

export default Dashboard;