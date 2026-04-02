import React, { useState, useEffect, useRef } from 'react';
import { 
  Calendar, Users, ChevronRight, ChevronLeft, Moon, Sun, Sunrise, 
  Play, MapPin, Wind, Coffee, X, CheckCircle, CreditCard, Plus, 
  Minus, Sparkles, Loader2, ShieldAlert, Menu, Compass, Mountain, 
  Waves, Star, Utensils, Camera, Map as MapIcon, ArrowLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";

// --- Firebase Imports ---
import { auth, db, appId } from './firebase';
import { 
  signInAnonymously, 
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  addDoc,
  query,
  where,
  getDocs
} from 'firebase/firestore';

// --- Types ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

// --- Error Handling ---
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Custom Hooks ---

const useScrollReveal = (threshold = 0.1) => {
  const [isRevealed, setIsRevealed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsRevealed(true);
          observer.unobserve(entry.target);
        }
      },
      { threshold, rootMargin: '0px 0px -50px 0px' }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [threshold]);

  return [ref, isRevealed] as const;
};

const Reveal = ({ children, delay = 0, className = '' }: { children: React.ReactNode, delay?: number, className?: string }) => {
  const [ref, isRevealed] = useScrollReveal();
  return (
    <div
      ref={ref}
      className={`transition-all duration-1000 ease-out ${
        isRevealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
      } ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
};

// --- Main Application ---

export default function App() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [timeOfDay, setTimeOfDay] = useState<'morning' | 'day' | 'night'>('day');
  const [currentView, setCurrentView] = useState<'home' | 'surroundings'>('home');

  // Firebase Auth State
  const [user, setUser] = useState<FirebaseUser | null>(null);
  
  // Real-time Booking State
  const [bookedDates, setBookedDates] = useState<number[]>([]);
  const [isCheckoutProcessing, setIsCheckoutProcessing] = useState(false);

  // Booking System State
  const [bookingStep, setBookingStep] = useState(0); // 0: closed, 1: dates, 2: extras, 3: payment, 4: success
  const [bookingData, setBookingData] = useState({
    checkIn: 20,
    checkOut: 20, // Start with same day to force selection
    guests: 2,
    unit: 'The Lakefront Pavilion',
    addons: [] as { name: string, price: number }[]
  });

  // AI Feature States
  const [conciergePrompt, setConciergePrompt] = useState('');
  const [conciergeResponse, setConciergeResponse] = useState('');
  const [isConciergeLoading, setIsConciergeLoading] = useState(false);
  
  const [packingList, setPackingList] = useState('');
  const [isPackingLoading, setIsPackingLoading] = useState(false);

  // Mobile Menu & Gallery
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [currentGalleryIndex, setCurrentGalleryIndex] = useState(0);

  const galleryImages = [
    "https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1510798831971-661eb04b3739?auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1587061949409-02df41d5e562?auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1478131143081-80f7f84ca84d?auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1533633310920-cc9bf1e7f9b0?auto=format&fit=crop&q=80"
  ];

  const nextImage = () => setCurrentGalleryIndex((prev) => (prev + 1) % galleryImages.length);
  const prevImage = () => setCurrentGalleryIndex((prev) => (prev - 1 + galleryImages.length) % galleryImages.length);

  // Security States & Form Data
  const [lastApiCallTime, setLastApiCallTime] = useState(0);
  const [checkoutData, setCheckoutData] = useState({ firstName: '', lastName: '', email: '', card: '', expiry: '', cvc: '' });
  const [checkoutErrors, setCheckoutErrors] = useState<Record<string, string>>({});

  // --- Firebase Effects ---

  useEffect(() => {
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (error) {
        console.error("Firebase Auth Error:", error);
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    
    const bookingsRef = collection(db, 'bookings');
    
    const unsubscribe = onSnapshot(bookingsRef, (snapshot) => {
      let allBookedDays: number[] = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.dates && Array.isArray(data.dates)) {
          allBookedDays = [...allBookedDays, ...data.dates];
        }
      });
      setBookedDates([...new Set(allBookedDays)]);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'bookings');
    });

    return () => unsubscribe();
  }, [user]);

  // --- AI Utilities ---

  const checkRateLimit = () => {
    const now = Date.now();
    if (now - lastApiCallTime < 5000) { 
      return false;
    }
    setLastApiCallTime(now);
    return true;
  };

  const handleConsultConcierge = async () => {
    if (!conciergePrompt.trim()) return;
    if (!checkRateLimit()) {
      alert("Please wait a moment before consulting the concierge again.");
      return;
    }

    setIsConciergeLoading(true);
    setConciergeResponse('');
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: conciergePrompt,
        config: {
          systemInstruction: "You are an exclusive, luxury virtual concierge for 'Lumina', a high-end glamping retreat in Slovenia. Keep your tone poetic, elegant, minimalist, and serene. The user will describe their ideal getaway or current mood. Recommend either 'The Lakefront Pavilion' or 'The Canopy Cabin', suggest 2 bespoke local activities (like stargazing, wine tasting, silent hikes), and set a calming mood. Keep your response under 3 short paragraphs. Do not use overly enthusiastic punctuation."
        }
      });
      setConciergeResponse(response.text || "The winds are too strong to reach our concierge at the moment.");
    } catch (error) {
      console.error(error);
      setConciergeResponse("We are experiencing a moment of profound silence. Our concierge is temporarily unavailable.");
    } finally {
      setIsConciergeLoading(false);
    }
  };

  const handleGeneratePackingList = async () => {
    if (!checkRateLimit()) return;
    setIsPackingLoading(true);
    
    const addonsText = bookingData.addons.length > 0 
      ? `They have also added: ${bookingData.addons.map(a => a.name).join(', ')}.` 
      : "They have no additional enhancements.";
      
    const prompt = `I am staying at ${bookingData.unit} for ${bookingData.checkOut - bookingData.checkIn} nights. ${addonsText} What should I pack?`;
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          systemInstruction: "You are a luxury travel advisor for Lumina glamping in Slovenia. Generate a minimalist, elegant packing list for the user based on their specific accommodation. Format the response with bullet points. Tone should be high-end, practical, and serene. Limit to 6-8 essential, thoughtful items."
        }
      });
      setPackingList(response.text || "Unable to generate list.");
    } catch (error) {
      console.error(error);
      setPackingList("Concierge is resting.");
    } finally {
      setIsPackingLoading(false);
    }
  };

  // --- Booking Logic ---

  const validateCheckout = () => {
    const errors: Record<string, string> = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cardRegex = /^[\d\s]{15,19}$/; 

    if (!checkoutData.firstName.trim()) errors.firstName = "First name required";
    if (!checkoutData.lastName.trim()) errors.lastName = "Last name required";
    if (!emailRegex.test(checkoutData.email)) errors.email = "Invalid email address";
    if (!cardRegex.test(checkoutData.card)) errors.card = "Invalid card number";
    if (!checkoutData.expiry.trim()) errors.expiry = "Required";
    if (!checkoutData.cvc.trim()) errors.cvc = "Required";

    setCheckoutErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCheckoutSubmit = async () => {
    if (!validateCheckout()) return;
    
    setIsCheckoutProcessing(true);

    const requestedDates: number[] = [];
    for (let i = bookingData.checkIn; i <= bookingData.checkOut; i++) {
      requestedDates.push(i);
    }

    if (user) {
      try {
        const bookingsRef = collection(db, 'bookings');
        await addDoc(bookingsRef, {
          userId: user.uid,
          unit: bookingData.unit,
          dates: requestedDates,
          guestName: `${checkoutData.firstName} ${checkoutData.lastName}`,
          createdAt: new Date().toISOString()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'bookings');
      }
    }

    setTimeout(() => {
      setIsCheckoutProcessing(false);
      setBookingStep(4);
    }, 1500);
  };

  const toggleAddon = (addonName: string, price: number) => {
    setBookingData(prev => {
      const exists = prev.addons.find(a => a.name === addonName);
      if (exists) {
        return { ...prev, addons: prev.addons.filter(a => a.name !== addonName) };
      }
      return { ...prev, addons: [...prev.addons, { name: addonName, price }] };
    });
  };

  const calculateTotal = () => {
    const nights = bookingData.checkOut - bookingData.checkIn;
    const validNights = nights > 0 ? nights : 1; 
    const basePrice = bookingData.unit === 'The Lakefront Pavilion' ? 350 : 280;
    const addonsPrice = bookingData.addons.reduce((sum, item) => sum + item.price, 0);
    return (validNights * basePrice) + addonsPrice;
  };

  useEffect(() => {
    const timer = setTimeout(() => setIsLoaded(true), 1500);
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const themes = {
    morning: {
      bg: 'bg-[#F9F6F0]',
      text: 'text-stone-800',
      accent: 'bg-stone-200',
      nav: scrolled ? 'bg-[#F9F6F0]/90 text-stone-900' : 'bg-transparent text-white',
      name: 'Morning Mist'
    },
    day: {
      bg: 'bg-stone-50',
      text: 'text-stone-900',
      accent: 'bg-stone-200',
      nav: scrolled ? 'bg-stone-50/90 text-stone-900' : 'bg-transparent text-white',
      name: 'Afternoon Sun'
    },
    night: {
      bg: 'bg-emerald-950',
      text: 'text-stone-200',
      accent: 'bg-emerald-900',
      nav: scrolled ? 'bg-emerald-950/90 text-stone-100' : 'bg-transparent text-white',
      name: 'Midnight Stars'
    }
  };

  const currentTheme = themes[timeOfDay];

  if (!isLoaded) {
    return (
      <div className="fixed inset-0 bg-stone-950 flex flex-col items-center justify-center z-50">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          className="w-12 h-12 border-t-2 border-stone-300 rounded-full mb-6"
        />
        <h1 className="font-serif text-2xl text-stone-300 tracking-[0.2em] font-light animate-pulse">
          LUMINA
        </h1>
      </div>
    );
  }

  return (
    <div className={`min-h-screen transition-colors duration-1000 ${currentTheme.bg} ${currentTheme.text} font-sans selection:bg-stone-400 selection:text-white`}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&family=Inter:wght@300;400;500&display=swap');
        .font-serif { font-family: 'Playfair Display', serif; }
        .font-sans { font-family: 'Inter', sans-serif; }
        html { scroll-behavior: smooth; }
      `}</style>

      {/* Floating Time Toggle */}
      <div className="fixed bottom-6 right-6 z-40 flex bg-white/10 backdrop-blur-md rounded-full p-1 border border-white/20 shadow-2xl">
        <button onClick={() => setTimeOfDay('morning')} className={`p-3 rounded-full transition-all duration-500 ${timeOfDay === 'morning' ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white'}`}>
          <Sunrise size={18} />
        </button>
        <button onClick={() => setTimeOfDay('day')} className={`p-3 rounded-full transition-all duration-500 ${timeOfDay === 'day' ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white'}`}>
          <Sun size={18} />
        </button>
        <button onClick={() => setTimeOfDay('night')} className={`p-3 rounded-full transition-all duration-500 ${timeOfDay === 'night' ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white'}`}>
          <Moon size={18} />
        </button>
      </div>

      {/* Navigation */}
      <nav className={`fixed w-full z-40 transition-all duration-700 backdrop-blur-sm ${currentTheme.nav}`}>
        <div className="max-w-7xl mx-auto px-6 py-5 flex justify-between items-center">
          <div 
            onClick={() => {
              setCurrentView('home');
              window.scrollTo(0, 0);
            }}
            className="text-sm font-medium tracking-[0.15em] uppercase z-50 cursor-pointer"
          >
            Lumina
          </div>
          
          <div className="hidden md:flex space-x-10 text-sm tracking-wider font-light">
            <a 
              href="#experience" 
              onClick={(e) => {
                if (currentView !== 'home') {
                  e.preventDefault();
                  setCurrentView('home');
                  setTimeout(() => {
                    document.getElementById('experience')?.scrollIntoView({ behavior: 'smooth' });
                  }, 100);
                }
              }}
              className="hover:opacity-60 transition-opacity"
            >
              Experience
            </a>
            <a 
              href="#accommodations" 
              onClick={(e) => {
                if (currentView !== 'home') {
                  e.preventDefault();
                  setCurrentView('home');
                  setTimeout(() => {
                    document.getElementById('accommodations')?.scrollIntoView({ behavior: 'smooth' });
                  }, 100);
                }
              }}
              className="hover:opacity-60 transition-opacity"
            >
              Accommodations
            </a>
            <button 
              onClick={() => {
                setCurrentView('surroundings');
                window.scrollTo(0, 0);
              }}
              className="hover:opacity-60 transition-opacity"
            >
              Explore
            </button>
            <a 
              href="#gallery" 
              onClick={(e) => {
                if (currentView !== 'home') {
                  e.preventDefault();
                  setCurrentView('home');
                  setTimeout(() => {
                    document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth' });
                  }, 100);
                }
              }}
              className="hover:opacity-60 transition-opacity"
            >
              Gallery
            </a>
          </div>
          
          <div className="hidden md:block">
            <button onClick={() => setBookingStep(1)} className="text-xs uppercase tracking-[0.2em] border border-current px-6 py-2 hover:bg-current hover:text-stone-900 transition-colors duration-500">
              Book Now
            </button>
          </div>

          <div className="md:hidden z-50">
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 -mr-2 outline-none">
              {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed inset-0 z-40 bg-stone-950/95 backdrop-blur-xl flex flex-col items-center justify-center"
          >
            <div className="flex flex-col items-center space-y-8 text-stone-200">
              <a 
                href="#experience" 
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  if (currentView !== 'home') {
                    setCurrentView('home');
                    setTimeout(() => {
                      document.getElementById('experience')?.scrollIntoView({ behavior: 'smooth' });
                    }, 100);
                  }
                }} 
                className="font-serif text-3xl tracking-wide"
              >
                Experience
              </a>
              <a 
                href="#accommodations" 
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  if (currentView !== 'home') {
                    setCurrentView('home');
                    setTimeout(() => {
                      document.getElementById('accommodations')?.scrollIntoView({ behavior: 'smooth' });
                    }, 100);
                  }
                }} 
                className="font-serif text-3xl tracking-wide"
              >
                Accommodations
              </a>
              <button 
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setCurrentView('surroundings');
                  window.scrollTo(0, 0);
                }} 
                className="font-serif text-3xl tracking-wide"
              >
                Explore Area
              </button>
              <a 
                href="#gallery" 
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  if (currentView !== 'home') {
                    setCurrentView('home');
                    setTimeout(() => {
                      document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth' });
                    }, 100);
                  }
                }} 
                className="font-serif text-3xl tracking-wide"
              >
                Gallery
              </a>
              <button 
                onClick={() => { setIsMobileMenuOpen(false); setBookingStep(1); }} 
                className="mt-8 text-xs uppercase tracking-[0.2em] border border-stone-200 px-10 py-4 hover:bg-stone-200 hover:text-stone-900 transition-colors duration-500"
              >
                Book Your Stay
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <AnimatePresence mode="wait">
        {currentView === 'home' ? (
          <motion.div 
            key="home"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            {/* Hero */}
            <header className="relative h-screen flex items-center justify-center overflow-hidden">
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat bg-fixed scale-105"
          style={{ 
            backgroundImage: "url('https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?auto=format&fit=crop&q=80')",
            filter: timeOfDay === 'night' ? 'brightness(0.5) contrast(1.2)' : timeOfDay === 'morning' ? 'brightness(0.8) contrast(0.9)' : 'brightness(0.7)'
          }}
        />
        <div className={`absolute inset-0 transition-colors duration-1000 ${
          timeOfDay === 'night' ? 'bg-emerald-950/60' : timeOfDay === 'morning' ? 'bg-stone-200/20' : 'bg-black/30'
        }`} />

        <div className="relative z-10 text-center text-white px-4 mt-20">
          <Reveal>
            <span className="block text-xs md:text-sm tracking-[0.3em] uppercase mb-6 font-light">Luxury lakeside glamping in pure nature</span>
          </Reveal>
          <Reveal delay={200}>
            <h1 className="font-serif text-5xl md:text-7xl lg:text-8xl font-medium tracking-wide mb-10 leading-tight">
              Escape to <br/><span className="italic font-light">Stillness</span>
            </h1>
          </Reveal>
          <Reveal delay={400}>
            <button className="group flex items-center mx-auto space-x-4 text-sm uppercase tracking-widest border-b border-white/30 pb-2 hover:border-white transition-colors">
              <span>Discover the Sanctuary</span>
              <Play size={14} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </Reveal>
        </div>
      </header>

      {/* Floating Booking Bar */}
      <div className="relative z-20 max-w-5xl mx-auto -mt-16 px-4 hidden md:block">
        <div className={`${timeOfDay === 'night' ? 'bg-emerald-900/90 text-stone-200 border-emerald-800' : 'bg-white/95 text-stone-800'} backdrop-blur-xl shadow-2xl p-6 flex items-center justify-between border ${timeOfDay !== 'night' && 'border-white'} transition-colors duration-1000`}>
          <div className="flex items-center space-x-4 border-r border-current/10 pr-8 w-1/3">
            <Calendar size={20} className="opacity-50" />
            <div className="flex flex-col">
              <span className="text-xs uppercase tracking-wider opacity-60">Arrival - Departure</span>
              <span className="text-sm font-medium mt-1">Select Dates</span>
            </div>
          </div>
          <div className="flex items-center space-x-4 px-8 w-1/3">
            <Users size={20} className="opacity-50" />
            <div className="flex flex-col">
              <span className="text-xs uppercase tracking-wider opacity-60">Guests</span>
              <span className="text-sm font-medium mt-1">2 Adults</span>
            </div>
          </div>
          <div className="w-1/3 flex justify-end">
            <button onClick={() => setBookingStep(1)} className={`${timeOfDay === 'night' ? 'bg-stone-200 text-emerald-950 hover:bg-white' : 'bg-stone-900 text-white hover:bg-stone-800'} px-8 py-4 text-xs uppercase tracking-[0.15em] transition-colors duration-500`}>
              Check Availability
            </button>
          </div>
        </div>
      </div>

      {/* Experience */}
      <section id="experience" className="py-32 md:py-48 px-6 max-w-7xl mx-auto">
        <div className="grid md:grid-cols-2 gap-16 md:gap-32 items-center">
          <div className="order-2 md:order-1 relative h-[60vh] overflow-hidden group">
            <img 
              src="https://images.unsplash.com/photo-1510798831971-661eb04b3739?auto=format&fit=crop&q=80" 
              alt="Cabin in woods" 
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-[2s] ease-out"
              referrerPolicy="no-referrer"
            />
          </div>
          <div className="order-1 md:order-2">
            <Reveal>
              <span className="text-xs uppercase tracking-[0.2em] opacity-60">The Experience</span>
              <h2 className="font-serif text-4xl md:text-5xl mt-6 mb-8 leading-tight">Private nature, <br/><span className="italic text-current/70">no crowds.</span></h2>
              <p className="font-light text-current/80 leading-relaxed mb-10 max-w-md text-lg">
                Wake up to the soft ripples of the lake and the scent of pine. Our meticulously designed sanctuaries blur the lines between indoors and out, offering an uncompromised immersion in wilderness.
              </p>
              <div className="grid grid-cols-2 gap-8 mb-8 border-t border-current/10 pt-8">
                <div>
                  <Wind size={20} className="mb-3 opacity-60" />
                  <h4 className="font-serif text-lg mb-1">Breathe</h4>
                  <p className="text-xs opacity-60 tracking-wide">Pure mountain air</p>
                </div>
                <div>
                  <Coffee size={20} className="mb-3 opacity-60" />
                  <h4 className="font-serif text-lg mb-1">Slow Down</h4>
                  <p className="text-xs opacity-60 tracking-wide">Curated morning rituals</p>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Explore */}
      <section id="explore" className={`py-24 px-6 border-y transition-colors duration-1000 ${timeOfDay === 'night' ? 'border-emerald-800/50 bg-emerald-950' : 'border-stone-200 bg-[#F9F6F0]'}`}>
        <div className="max-w-7xl mx-auto">
          <Reveal className="text-center mb-16">
            <span className="text-xs uppercase tracking-[0.2em] opacity-60">The Surroundings</span>
            <h2 className="font-serif text-4xl md:text-5xl mt-6">Immerse in <span className="italic">Wilderness</span></h2>
          </Reveal>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            <Reveal delay={100} className="flex flex-col items-center text-center group">
              <div className="w-16 h-16 rounded-full border border-current/20 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-current transition-all duration-500">
                <Mountain size={24} className="opacity-70 group-hover:text-[#F9F6F0] group-hover:opacity-100 transition-colors" />
              </div>
              <h3 className="font-serif text-2xl mb-3">Alpine Hiking</h3>
              <p className="font-light text-sm opacity-70 leading-relaxed px-4">Discover hidden trails and breathtaking vistas just steps from your sanctuary. From gentle walks to challenging peaks.</p>
            </Reveal>

            <Reveal delay={200} className="flex flex-col items-center text-center group">
              <div className="w-16 h-16 rounded-full border border-current/20 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-current transition-all duration-500">
                <Waves size={24} className="opacity-70 group-hover:text-[#F9F6F0] group-hover:opacity-100 transition-colors" />
              </div>
              <h3 className="font-serif text-2xl mb-3">Lake Kayaking</h3>
              <p className="font-light text-sm opacity-70 leading-relaxed px-4">Glide across the glassy, serene waters in our complimentary cedar-strip kayaks available exclusively for guests.</p>
            </Reveal>

            <Reveal delay={300} className="flex flex-col items-center text-center group">
              <div className="w-16 h-16 rounded-full border border-current/20 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-current transition-all duration-500">
                <Star size={24} className="opacity-70 group-hover:text-[#F9F6F0] group-hover:opacity-100 transition-colors" />
              </div>
              <h3 className="font-serif text-2xl mb-3">Stargazing</h3>
              <p className="font-light text-sm opacity-70 leading-relaxed px-4">Zero light pollution allows for profound cosmic observation directly from your private outdoor deck.</p>
            </Reveal>
          </div>

          <Reveal delay={400} className="text-center mt-16">
            <button 
              onClick={() => {
                setCurrentView('surroundings');
                window.scrollTo(0, 0);
              }}
              className="px-10 py-4 border border-current/30 text-xs uppercase tracking-[0.2em] hover:bg-current hover:text-stone-900 transition-all duration-500"
            >
              Explore Surroundings
            </button>
          </Reveal>
        </div>
      </section>

      {/* AI Concierge */}
      <section className={`py-24 px-6 max-w-4xl mx-auto border-y transition-colors duration-1000 ${timeOfDay === 'night' ? 'border-emerald-800/50' : 'border-stone-200'}`}>
        <Reveal>
          <div className="text-center mb-12">
            <Sparkles size={24} className="mx-auto mb-4 opacity-50" />
            <h2 className="font-serif text-3xl md:text-4xl mb-4">Consult the Concierge</h2>
            <p className="font-light text-sm opacity-70 max-w-lg mx-auto">
              Tell us what you seek from your escape—be it profound silence, romantic connection, or creative inspiration. Our intelligence will curate your perfect sanctuary.
            </p>
          </div>
          
          <div className="max-w-2xl mx-auto">
            <div className="relative">
              <textarea 
                value={conciergePrompt}
                onChange={(e) => setConciergePrompt(e.target.value)}
                placeholder="E.g., We are looking for a quiet anniversary weekend with wine and stargazing..."
                className={`w-full p-6 pb-16 bg-transparent border outline-none resize-none transition-colors font-light text-sm ${timeOfDay === 'night' ? 'border-emerald-800 focus:border-emerald-500 placeholder:text-emerald-800/50' : 'border-stone-300 focus:border-stone-800 placeholder:text-stone-400'}`}
                rows={4}
              />
              <button 
                onClick={handleConsultConcierge}
                disabled={isConciergeLoading || !conciergePrompt.trim()}
                className={`absolute bottom-4 right-4 px-6 py-2 text-xs uppercase tracking-widest flex items-center space-x-2 transition-all disabled:opacity-50 ${timeOfDay === 'night' ? 'bg-stone-200 text-emerald-950 hover:bg-white' : 'bg-stone-900 text-white hover:bg-stone-800'}`}
              >
                {isConciergeLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                <span>Curate My Stay</span>
              </button>
            </div>

            {conciergeResponse && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-8 p-8 border border-current/10 bg-current/5"
              >
                <div className="font-serif text-sm leading-loose whitespace-pre-wrap opacity-90">
                  {conciergeResponse}
                </div>
              </motion.div>
            )}
          </div>
        </Reveal>
      </section>

      {/* Extra Services Section */}
      <section id="services" className="py-24 px-6 max-w-7xl mx-auto">
        <Reveal className="text-center mb-16">
          <span className="text-xs uppercase tracking-[0.2em] opacity-60">Enhance Your Stay</span>
          <h2 className="font-serif text-4xl md:text-5xl mt-6">Extra <span className="italic">Services</span></h2>
          <p className="font-light text-sm opacity-70 max-w-lg mx-auto mt-4">Tailor your escape with our curated selection of local experiences and comforts.</p>
        </Reveal>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {[
            { name: 'Rent a Bike or SUP', price: 25, icon: <Compass size={24} />, desc: 'Explore the trails or the lake at your own pace.' },
            { name: 'Dinner Under the Stars', price: 120, icon: <Star size={24} />, desc: 'A private, 4-course gourmet meal served on your deck.' },
            { name: 'Farm Breakfast', price: 35, icon: <Coffee size={24} />, desc: 'Fresh local produce delivered in a rustic basket.' },
            { name: 'Private Yoga Session', price: 60, icon: <Sunrise size={24} />, desc: 'A restorative 60-minute session at sunrise.' }
          ].map((service, idx) => (
            <div key={service.name}>
              <Reveal delay={idx * 100} className="p-8 border border-current/10 bg-current/5 hover:bg-current/10 transition-colors group">
                <div className="mb-6 opacity-60 group-hover:scale-110 transition-transform duration-500">{service.icon}</div>
                <h3 className="font-serif text-xl mb-2">{service.name}</h3>
                <p className="text-sm font-light opacity-70 mb-4">{service.desc}</p>
                <span className="text-sm font-medium">€{service.price}</span>
              </Reveal>
            </div>
          ))}
        </div>
      </section>

      {/* Accommodations */}
      <section id="accommodations" className={`${timeOfDay === 'night' ? 'bg-emerald-900/30' : 'bg-stone-100'} py-32 transition-colors duration-1000`}>
        <div className="max-w-7xl mx-auto px-6">
          <Reveal className="text-center mb-20">
            <span className="text-xs uppercase tracking-[0.2em] opacity-60">Sanctuaries</span>
            <h2 className="font-serif text-4xl md:text-5xl mt-6">Design meets <span className="italic">wilderness</span></h2>
          </Reveal>

          <div className="grid md:grid-cols-2 gap-8 lg:gap-12">
            {/* Unit 1 */}
            <Reveal delay={100} className="group cursor-pointer">
              <div className="overflow-hidden relative h-[500px]">
                <img 
                  src="https://images.unsplash.com/photo-1587061949409-02df41d5e562?auto=format&fit=crop&q=80" 
                  alt="Luxury Tent Interior" 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-[1.5s] ease-out"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors duration-700" />
                <div className="absolute top-6 right-6 bg-white/90 backdrop-blur text-stone-900 px-4 py-2 text-xs uppercase tracking-wider">
                  From €350 / night
                </div>
              </div>
              <div className="pt-8 pb-4">
                <div className="flex justify-between items-baseline mb-3">
                  <h3 className="font-serif text-2xl">The Lakefront Pavilion</h3>
                  <span className="text-xs uppercase tracking-wider opacity-60">2 Guests • 45m²</span>
                </div>
                <p className="font-light opacity-70 mb-6 text-sm">A canvas and glass masterpiece positioned directly on the water's edge, featuring a private soaking tub and panoramic views.</p>
                <span className="text-xs uppercase tracking-[0.15em] border-b border-current/30 pb-1 group-hover:border-current transition-colors flex inline-flex items-center space-x-2">
                  <span>View Details</span>
                  <ChevronRight size={12} />
                </span>
              </div>
            </Reveal>

            {/* Unit 2 */}
            <Reveal delay={300} className="group cursor-pointer">
              <div className="overflow-hidden relative h-[500px]">
                <img 
                  src="https://images.unsplash.com/photo-1533633310920-cc9bf1e7f9b0?auto=format&fit=crop&q=80" 
                  alt="Forest Cabin" 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-[1.5s] ease-out"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors duration-700" />
                <div className="absolute top-6 right-6 bg-white/90 backdrop-blur text-stone-900 px-4 py-2 text-xs uppercase tracking-wider">
                  From €280 / night
                </div>
              </div>
              <div className="pt-8 pb-4">
                <div className="flex justify-between items-baseline mb-3">
                  <h3 className="font-serif text-2xl">The Canopy Cabin</h3>
                  <span className="text-xs uppercase tracking-wider opacity-60">2 Guests • 38m²</span>
                </div>
                <p className="font-light opacity-70 mb-6 text-sm">Elevated among the ancient pines, this wooden sanctuary offers absolute seclusion, a wood-burning stove, and a stargazing deck.</p>
                <span className="text-xs uppercase tracking-[0.15em] border-b border-current/30 pb-1 group-hover:border-current transition-colors flex inline-flex items-center space-x-2">
                  <span>View Details</span>
                  <ChevronRight size={12} />
                </span>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Gallery */}
      <section id="gallery" className="w-full relative bg-stone-950">
        <div className="relative w-full h-[60vh] md:h-[80vh] overflow-hidden">
          {galleryImages.map((src, idx) => (
            <motion.img
              key={idx}
              src={src}
              alt={`Lumina Gallery ${idx + 1}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: idx === currentGalleryIndex ? 1 : 0 }}
              transition={{ duration: 1 }}
              className="absolute inset-0 w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          ))}
          
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20 z-20 pointer-events-none" />
          
          <div className="absolute inset-0 z-30 flex items-center justify-between px-4 md:px-12 pointer-events-none">
            <button onClick={prevImage} className="pointer-events-auto w-12 h-12 flex items-center justify-center rounded-full bg-black/20 text-white backdrop-blur-md border border-white/20 hover:bg-white/20 transition-all">
              <ChevronLeft size={24} />
            </button>
            <button onClick={nextImage} className="pointer-events-auto w-12 h-12 flex items-center justify-center rounded-full bg-black/20 text-white backdrop-blur-md border border-white/20 hover:bg-white/20 transition-all">
              <ChevronRight size={24} />
            </button>
          </div>

          <div className="absolute bottom-8 left-0 right-0 z-30 flex justify-center space-x-3">
            {galleryImages.map((_, idx) => (
              <button 
                key={idx}
                onClick={() => setCurrentGalleryIndex(idx)}
                className={`transition-all duration-500 rounded-full ${idx === currentGalleryIndex ? 'w-8 h-1 bg-white' : 'w-2 h-1 bg-white/40 hover:bg-white/60'}`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={`${timeOfDay === 'night' ? 'bg-stone-950 text-stone-400' : 'bg-stone-900 text-stone-300'} pt-24 pb-12 px-6 transition-colors duration-1000`}>
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-12 mb-24">
          <div className="col-span-1 md:col-span-2">
            <h2 className="font-serif text-3xl text-white mb-6">Lumina</h2>
            <p className="font-light text-sm max-w-sm leading-relaxed mb-8 opacity-70">
              A luxury nature escape designed for stillness, connection, and profound rest. Disconnect to reconnect.
            </p>
          </div>
          
          <div>
            <h4 className="text-xs uppercase tracking-[0.2em] text-white mb-6">Explore</h4>
            <ul className="space-y-4 font-light text-sm">
              <li><a href="#accommodations" className="hover:text-white transition-colors">Accommodations</a></li>
              <li><a href="#experience" className="hover:text-white transition-colors">Experiences</a></li>
              <li><a href="#explore" className="hover:text-white transition-colors">Explore</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs uppercase tracking-[0.2em] text-white mb-6">Contact</h4>
            <ul className="space-y-4 font-light text-sm">
              <li className="flex items-start space-x-3">
                <MapPin size={16} className="mt-0.5" />
                <span>Lake Bled Area, Slovenia</span>
              </li>
              <li className="pt-2">reserve@lumina-escape.com</li>
            </ul>
          </div>
        </div>

        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center pt-8 border-t border-current/10 text-xs font-light">
          <p>&copy; 2026 Lumina Escape. All rights reserved.</p>
        </div>
      </footer>
    </motion.div>
  ) : (
    <motion.div 
      key="surroundings"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.5 }}
      className="pt-32 pb-24 px-6 max-w-7xl mx-auto"
    >
      <button 
        onClick={() => {
          setCurrentView('home');
          window.scrollTo(0, 0);
        }}
        className="flex items-center space-x-2 text-xs uppercase tracking-widest opacity-60 hover:opacity-100 transition-opacity mb-12"
      >
        <ArrowLeft size={14} />
        <span>Back to Sanctuary</span>
      </button>

      <div className="mb-20">
        <span className="text-xs uppercase tracking-[0.2em] opacity-60">The Area</span>
        <h1 className="font-serif text-5xl md:text-7xl mt-6 mb-8">Explore the <span className="italic">Surroundings</span></h1>
        <p className="font-light text-lg opacity-70 max-w-2xl leading-relaxed">
          Lumina is nestled in the heart of the Julian Alps, surrounded by emerald lakes, ancient forests, and the warm hospitality of Slovenian tradition.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-24">
        {/* Attractions */}
        <div>
          <h2 className="font-serif text-3xl mb-12 flex items-center space-x-4">
            <Camera size={28} className="opacity-40" />
            <span>Local Attractions</span>
          </h2>
          <div className="space-y-12">
            {[
              { 
                name: 'Lake Bled & Island', 
                dist: '15 min drive', 
                desc: 'The iconic alpine lake with its church-topped island. We recommend a traditional Pletna boat ride at sunrise to avoid the crowds.',
                img: 'https://images.unsplash.com/photo-1589182373726-e4f658ab50f0?auto=format&fit=crop&q=80'
              },
              { 
                name: 'Vintgar Gorge', 
                dist: '20 min drive', 
                desc: 'A 1.6km wooden walkway carved into the Radovna River gorge. Crystal clear turquoise water and dramatic waterfalls.',
                img: 'https://images.unsplash.com/photo-1542332213-31f87348057f?auto=format&fit=crop&q=80'
              },
              { 
                name: 'Triglav National Park', 
                dist: '30 min drive', 
                desc: 'The only national park in Slovenia, offering endless hiking trails, high-altitude lakes, and the majestic peak of Mount Triglav.',
                img: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&q=80'
              }
            ].map(attr => (
              <div key={attr.name} className="group">
                <div className="overflow-hidden h-64 mb-6 relative">
                  <img src={attr.img} alt={attr.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" referrerPolicy="no-referrer" />
                </div>
                <div className="flex justify-between items-start mb-3">
                  <h3 className="font-serif text-2xl">{attr.name}</h3>
                  <span className="text-xs uppercase tracking-widest opacity-50 mt-2">{attr.dist}</span>
                </div>
                <p className="font-light text-sm opacity-70 leading-relaxed">{attr.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Restaurants */}
        <div>
          <h2 className="font-serif text-3xl mb-12 flex items-center space-x-4">
            <Utensils size={28} className="opacity-40" />
            <span>Culinary Experiences</span>
          </h2>
          <div className="space-y-12">
            {[
              { 
                name: 'Gostilna Pri Planincu', 
                type: 'Traditional Slovenian', 
                desc: 'A historic inn serving hearty local dishes since 1903. Famous for their mushroom soup and traditional Carniolan sausage.',
                price: '€€'
              },
              { 
                name: 'Garden Village Restaurant', 
                type: 'Farm-to-Table', 
                desc: 'Dine in a greenhouse setting where herbs and vegetables grow right beside your table. Modern interpretations of local ingredients.',
                price: '€€€'
              },
              { 
                name: 'Bled Castle Restaurant', 
                type: 'Fine Dining', 
                desc: 'Exquisite cuisine paired with the most breathtaking view of Lake Bled. Perfect for a romantic evening or special celebration.',
                price: '€€€€'
              },
              { 
                name: 'Old Cellar Bled', 
                type: 'Wine & Tapas', 
                desc: 'An intimate cellar focused on Slovenian wines and artisanal cheeses. A perfect spot for a relaxed evening after a day of hiking.',
                price: '€€'
              }
            ].map(rest => (
              <div key={rest.name} className="p-8 border border-current/10 bg-current/5 hover:bg-current/10 transition-colors">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-serif text-2xl mb-1">{rest.name}</h3>
                    <span className="text-xs uppercase tracking-widest opacity-50">{rest.type}</span>
                  </div>
                  <span className="text-sm font-medium opacity-60">{rest.price}</span>
                </div>
                <p className="font-light text-sm opacity-70 leading-relaxed">{rest.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-20 p-10 border border-current/20 text-center">
            <MapIcon size={32} className="mx-auto mb-6 opacity-40" />
            <h3 className="font-serif text-2xl mb-4">Need a personalized map?</h3>
            <p className="font-light text-sm opacity-70 mb-8">
              Our concierge can prepare a custom digital map with hidden spots tailored to your interests.
            </p>
            <button 
              onClick={() => {
                setCurrentView('home');
                setTimeout(() => {
                  const conciergeSection = document.getElementById('concierge');
                  if (conciergeSection) conciergeSection.scrollIntoView({ behavior: 'smooth' });
                }, 100);
              }}
              className="text-xs uppercase tracking-[0.2em] border border-current px-8 py-3 hover:bg-current hover:text-stone-900 transition-colors"
            >
              Ask Concierge
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )}
</AnimatePresence>

      {/* Booking Modal */}
      <AnimatePresence>
        {bookingStep > 0 && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/80 backdrop-blur-md"
          >
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              className="bg-[#F9F6F0] w-full max-w-5xl h-[90vh] max-h-[750px] flex overflow-hidden shadow-2xl relative text-stone-900"
            >
              <button onClick={() => setBookingStep(0)} className="absolute top-6 right-6 z-20 text-stone-500 hover:text-stone-900 bg-white/50 backdrop-blur p-2 rounded-full">
                <X size={20} />
              </button>

              <div className="hidden md:block w-2/5 relative bg-stone-200">
                <img 
                  src={bookingData.unit === 'The Lakefront Pavilion' 
                    ? "https://images.unsplash.com/photo-1587061949409-02df41d5e562?auto=format&fit=crop&q=80" 
                    : "https://images.unsplash.com/photo-1533633310920-cc9bf1e7f9b0?auto=format&fit=crop&q=80"}
                  alt="Selected Unit" 
                  className="absolute inset-0 w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-stone-900/90 via-stone-900/30 to-transparent p-10 flex flex-col justify-end text-white">
                  <span className="text-xs uppercase tracking-[0.2em] opacity-80 mb-2">Your Reservation</span>
                  <h3 className="font-serif text-3xl mb-6">{bookingData.unit}</h3>
                  {bookingStep > 1 && (
                    <div className="space-y-4 text-sm font-light border-t border-white/20 pt-6">
                      <div className="flex justify-between">
                        <span className="opacity-80">Dates</span>
                        <span>Aug {bookingData.checkIn} - {bookingData.checkOut}, 2026</span>
                      </div>
                      {bookingData.addons.length > 0 && (
                        <div className="flex justify-between">
                          <span className="opacity-80">Enhancements</span>
                          <span className="text-right">
                            {bookingData.addons.map(a => <div key={a.name}>{a.name}</div>)}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between font-medium text-lg pt-4 border-t border-white/20">
                        <span>Total</span>
                        <span>€{calculateTotal()}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="w-full md:w-3/5 p-8 md:p-16 flex flex-col overflow-y-auto">
                {bookingStep < 4 && (
                  <div className="flex space-x-2 mb-12">
                    {[1, 2, 3].map(step => (
                      <div key={step} className={`h-1 flex-1 transition-colors duration-500 ${bookingStep >= step ? 'bg-stone-800' : 'bg-stone-200'}`} />
                    ))}
                  </div>
                )}

                {bookingStep === 1 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <h2 className="font-serif text-3xl mb-2">When would you like to escape?</h2>
                    <p className="text-stone-500 font-light text-sm mb-10">Select your arrival and departure dates.</p>
                    
                    <div className="mb-8">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="font-medium">August 2026</h3>
                      </div>
                      <div className="grid grid-cols-7 gap-2 text-center text-xs font-medium text-stone-400 mb-2">
                        {['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].map(d => <div key={d}>{d}</div>)}
                      </div>
                      <div className="grid grid-cols-7 gap-2 text-sm">
                        {Array.from({length: 5}).map((_, i) => <div key={`blank-${i}`} className="p-3"></div>)}
                        {Array.from({length: 31}).map((_, i) => {
                          const day = i + 1;
                          const isBooked = bookedDates.includes(day);
                          const isSelected = day >= bookingData.checkIn && day <= bookingData.checkOut && !isBooked;
                          const isEndpoint = (day === bookingData.checkIn || day === bookingData.checkOut) && !isBooked;
                          
                          return (
                            <div 
                              key={day} 
                            onClick={() => {
                              if (isBooked) return;
                              
                              if (bookingData.checkIn === bookingData.checkOut) {
                                if (day > bookingData.checkIn) {
                                  // Check for blocked dates in between
                                  const hasBlocked = bookedDates.some(d => d > bookingData.checkIn && d < day);
                                  if (!hasBlocked) {
                                    setBookingData({ ...bookingData, checkOut: day });
                                  } else {
                                    setBookingData({ ...bookingData, checkIn: day, checkOut: day });
                                  }
                                } else {
                                  setBookingData({ ...bookingData, checkIn: day, checkOut: day });
                                }
                              } else {
                                setBookingData({ ...bookingData, checkIn: day, checkOut: day });
                              }
                            }}
                              className={`p-3 rounded-full transition-colors text-center cursor-pointer
                                ${isBooked ? 'opacity-30 cursor-not-allowed bg-stone-100 text-stone-400 line-through' 
                                : isSelected ? 'bg-stone-800 text-white' 
                                : 'hover:bg-stone-200 text-stone-700'}
                                ${isEndpoint && !isBooked && 'font-bold ring-2 ring-stone-800 ring-offset-2'}
                              `}
                            >
                              {day}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                    <button 
                      onClick={() => setBookingStep(2)} 
                      disabled={bookingData.checkIn === bookingData.checkOut}
                      className="w-full bg-stone-900 text-white py-4 text-xs uppercase tracking-widest hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {bookingData.checkIn === bookingData.checkOut ? 'Select Departure Date' : 'Continue to Sanctuaries'}
                    </button>
                  </motion.div>
                )}

                {bookingStep === 2 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <h2 className="font-serif text-3xl mb-8">Select your sanctuary</h2>
                    <div className="space-y-4 mb-10">
                      {[
                        { name: 'The Lakefront Pavilion', price: 350, desc: 'Positioned directly on the water\'s edge.' },
                        { name: 'The Canopy Cabin', price: 280, desc: 'Elevated among the ancient pines.' }
                      ].map(unit => (
                        <div 
                          key={unit.name}
                          onClick={() => setBookingData({...bookingData, unit: unit.name})}
                          className={`p-5 border cursor-pointer transition-all ${bookingData.unit === unit.name ? 'border-stone-900 bg-stone-100/50' : 'border-stone-200 hover:border-stone-400'}`}
                        >
                          <div className="flex justify-between items-center mb-1">
                            <h4 className="font-medium text-lg">{unit.name}</h4>
                            <span className="text-sm">€{unit.price} / night</span>
                          </div>
                          <p className="text-stone-500 text-sm font-light">{unit.desc}</p>
                        </div>
                      ))}
                    </div>

                    <h3 className="font-serif text-2xl mb-6">Curated Enhancements</h3>
                    <div className="space-y-4 mb-10">
                      {[
                        { name: 'Rent a Bike or SUP', price: 25, desc: 'Daily rental for exploration.' },
                        { name: 'Dinner Under the Stars', price: 120, desc: 'Private gourmet experience.' },
                        { name: 'Farm Breakfast', price: 35, desc: 'Fresh local basket delivered daily.' },
                        { name: 'Private Yoga Session', price: 60, desc: '60-minute restorative session.' }
                      ].map(addon => {
                        const isSelected = bookingData.addons.some(a => a.name === addon.name);
                        return (
                          <div key={addon.name} className="flex items-center justify-between p-4 border border-stone-200">
                            <div>
                              <h4 className="font-medium text-sm">{addon.name}</h4>
                              <p className="text-stone-500 text-xs font-light mt-1">{addon.desc}</p>
                            </div>
                            <button 
                              onClick={() => toggleAddon(addon.name, addon.price)}
                              className={`flex items-center space-x-2 text-xs uppercase tracking-wider px-4 py-2 border transition-colors ${isSelected ? 'bg-stone-900 text-white border-stone-900' : 'border-stone-300 hover:border-stone-900'}`}
                            >
                              {isSelected ? <><CheckCircle size={14} /> <span>Added</span></> : <><Plus size={14} /> <span>€{addon.price}</span></>}
                            </button>
                          </div>
                        )
                      })}
                    </div>

                    <div className="flex space-x-4">
                      <button onClick={() => setBookingStep(1)} className="px-6 py-4 border border-stone-300 text-xs uppercase tracking-widest">Back</button>
                      <button onClick={() => setBookingStep(3)} className="flex-1 bg-stone-900 text-white py-4 text-xs uppercase tracking-widest">Proceed to Checkout</button>
                    </div>
                  </motion.div>
                )}

                {bookingStep === 3 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <h2 className="font-serif text-3xl mb-8">Finalize your stay</h2>
                    <div className="space-y-6 mb-10">
                      <div className="grid grid-cols-2 gap-4">
                        <input 
                          type="text" 
                          value={checkoutData.firstName}
                          onChange={e => setCheckoutData({...checkoutData, firstName: e.target.value})}
                          className="w-full p-3 bg-transparent border border-stone-300 outline-none" 
                          placeholder="First Name" 
                        />
                        <input 
                          type="text" 
                          value={checkoutData.lastName}
                          onChange={e => setCheckoutData({...checkoutData, lastName: e.target.value})}
                          className="w-full p-3 bg-transparent border border-stone-300 outline-none" 
                          placeholder="Last Name" 
                        />
                      </div>
                      <input 
                        type="email" 
                        value={checkoutData.email}
                        onChange={e => setCheckoutData({...checkoutData, email: e.target.value})}
                        className="w-full p-3 bg-transparent border border-stone-300 outline-none" 
                        placeholder="Email Address" 
                      />
                      <div className="bg-white rounded-md border border-stone-200 p-4">
                        <input 
                          type="text" 
                          value={checkoutData.card}
                          onChange={e => setCheckoutData({...checkoutData, card: e.target.value})}
                          className="w-full p-2 text-sm outline-none" 
                          placeholder="Card Number (Mock)" 
                        />
                      </div>
                    </div>
                    <div className="flex space-x-4">
                      <button onClick={() => setBookingStep(2)} className="px-6 py-4 border border-stone-300 text-xs uppercase tracking-widest">Back</button>
                      <button 
                        onClick={handleCheckoutSubmit} 
                        disabled={isCheckoutProcessing}
                        className="flex-1 bg-stone-900 text-white py-4 text-xs uppercase tracking-widest flex items-center justify-center space-x-2"
                      >
                        {isCheckoutProcessing ? <Loader2 size={16} className="animate-spin" /> : <span>Confirm & Pay €{calculateTotal()}</span>}
                      </button>
                    </div>
                  </motion.div>
                )}

                {bookingStep === 4 && (
                  <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center justify-center h-full text-center py-8">
                    <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-800 mb-6">
                      <CheckCircle size={32} />
                    </div>
                    <h2 className="font-serif text-4xl mb-4">Your sanctuary is reserved.</h2>
                    <p className="text-stone-500 font-light max-w-sm mb-8">We look forward to welcoming you to the wilderness.</p>
                    
                    <div className="w-full max-w-md bg-white border border-stone-200 p-6 mb-8 text-left">
                      <h4 className="font-medium text-sm mb-2 flex items-center">
                        <Sparkles size={14} className="mr-2 text-stone-400" /> Prepare for your journey
                      </h4>
                      {!packingList ? (
                        <button 
                          onClick={handleGeneratePackingList}
                          disabled={isPackingLoading}
                          className="w-full py-3 border border-stone-300 text-xs uppercase tracking-widest flex items-center justify-center space-x-2"
                        >
                          {isPackingLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                          <span>Generate Packing List</span>
                        </button>
                      ) : (
                        <div className="bg-stone-50 p-4 text-xs font-light text-stone-600 whitespace-pre-wrap">
                          {packingList}
                        </div>
                      )}
                    </div>

                    <button 
                      onClick={() => { setBookingStep(0); setPackingList(''); }} 
                      className="bg-stone-900 text-white px-10 py-4 text-xs uppercase tracking-widest"
                    >
                      Return to Homepage
                    </button>
                  </motion.div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
