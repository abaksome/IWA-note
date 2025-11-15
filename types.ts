export type Priority = 'High' | 'Medium' | 'Low';

export interface Note {
  id: string;
  content: string;
  createdAt: Date;
}

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  priority: Priority;
  reminder?: string; // ISO string for the reminder date/time
  notified?: boolean; // To prevent duplicate notifications
}

export interface Attendee {
  name: string;
  email: string;
  phone?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  time: string;
  attendees?: Attendee[];
  description?: string;
  reminder?: number; // Minutes before the event
  notified?: boolean; // To prevent duplicate notifications
}

export interface VoiceNote {
  id: string;
  transcription: string;
  createdAt: Date;
  duration?: number; // Duration in seconds
}

export type ActiveView = 'notes' | 'voice' | 'todos' | 'calendar' | 'settings';