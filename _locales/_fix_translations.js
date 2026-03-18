const fs = require("fs");
const path = require("path");

const en = JSON.parse(fs.readFileSync(path.join(__dirname, "en/messages.json"), "utf8"));
const enKeys = Object.keys(en);

// These keys are intentionally the same across all languages (onomatopoeia/universal markers)
const SKIP_KEYS = new Set(["badgeZzz", "markSuspendedPrefix"]);

// Some keys legitimately match English in certain languages
const LEGITIMATE_MATCHES = {
  de: new Set(["badgeSystem", "badgeAudio", "changelogVersion"]),
  fr: new Set(["badgeAudio", "sessions", "timer5min", "timer10min", "timer15min", "timer30min", "sessionDefaultName", "privacyContactTitle", "changelogVersion"]),
  es: new Set(["badgeAudio"]),
  es_419: new Set(["badgeAudio"]),
  it: new Set(["badgeAudio"]),
  pt_BR: new Set([]),
  pt_PT: new Set([]),
  da: new Set(["badgeSystem", "sessionDefaultName"]),
  sv: new Set(["badgeSystem", "sessionDefaultName"]),
  nl: new Set(["badgeAudio", "privacyContactTitle"]),
  nb: new Set(["badgeSystem"]),
  no: new Set(["badgeSystem"]),
  fil: new Set(["badgeSystem", "badgeAudio", "sessionDefaultName"]),
  ro: new Set(["badgeAudio", "privacyContactTitle"]),
  id: new Set(["badgeAudio"]),
  ms: new Set(["badgeAudio"]),
  lv: new Set(["badgeAudio"]),
  sk: new Set(["badgeAudio"]),
  sl: new Set(["badgeAudio"]),
  pl: new Set(["badgeSystem", "badgeAudio"]),
  ca: new Set(["sessions"]),
};

// Complete translations for all keys that need fixing
// Each key maps to {locale: translated_message}
const T = {};

// --- replace ---
T.replace = {
  am: "ተካ", bg: "Замени", bn: "প্রতিস্থাপন", ca: "Substitueix",
  cs: "Nahradit", da: "Erstat", el: "Αντικατάσταση", et: "Asenda",
  fa: "جایگزینی", fi: "Korvaa", fil: "Palitan", gu: "બદલો",
  he: "החלף", hr: "Zamijeni", hu: "Csere", id: "Ganti",
  kn: "ಬದಲಿಸಿ", lt: "Pakeisti", lv: "Aizvietot", ml: "മാറ്റിസ്ഥാപിക്കുക",
  mr: "बदला", ms: "Ganti", nb: "Erstatt", nl: "Vervangen",
  no: "Erstatt", or: "ବଦଳାନ୍ତୁ", pl: "Zastąp", ro: "Înlocuiește",
  sk: "Nahradiť", sl: "Zamenjaj", sr: "Замени", sv: "Ersätt",
  sw: "Badilisha", ta: "மாற்றவும்", te: "భర్తీ చేయండి", th: "แทนที่",
  uk: "Замінити", vi: "Thay thế"
};

// --- replaceSessionTitle ---
T.replaceSessionTitle = {
  am: "አሁን ያሉ ትሮች በዚህ ክፍለ ጊዜ ተካ",
  bg: "Замени текущите раздели с тази сесия",
  bn: "বর্তমান ট্যাবগুলি এই সেশন দিয়ে প্রতিস্থাপন করুন",
  ca: "Substitueix les pestanyes actuals per aquesta sessió",
  cs: "Nahradit aktuální karty touto relací",
  da: "Erstat nuværende faner med denne session",
  el: "Αντικατάσταση τρεχουσών καρτελών με αυτή τη συνεδρία",
  et: "Asenda praegused vahelehed selle seansiga",
  fa: "جایگزینی تب‌های فعلی با این جلسه",
  fi: "Korvaa nykyiset välilehdet tällä istunnolla",
  fil: "Palitan ang kasalukuyang mga tab ng session na ito",
  gu: "આ સત્ર સાથે વર્તમાન ટૅબ્સ બદલો",
  he: "החלף כרטיסיות נוכחיות בהפעלה זו",
  hr: "Zamijeni trenutne kartice ovom sesijom",
  hu: "Cseréld le a jelenlegi lapokat erre a munkamenetre",
  id: "Ganti tab saat ini dengan sesi ini",
  kn: "ಈ ಅವಧಿಯೊಂದಿಗೆ ಪ್ರಸ್ತುತ ಟ್ಯಾಬ್‌ಗಳನ್ನು ಬದಲಿಸಿ",
  lt: "Pakeisti dabartinius skirtukus šia sesija",
  lv: "Aizvietot pašreizējās cilnes ar šo sesiju",
  ml: "നിലവിലെ ടാബുകൾ ഈ സെഷനുമായി മാറ്റിസ്ഥാപിക്കുക",
  mr: "सध्याचे टॅब या सत्रासह बदला",
  ms: "Ganti tab semasa dengan sesi ini",
  nb: "Erstatt nåværende faner med denne økten",
  nl: "Huidige tabbladen vervangen door deze sessie",
  no: "Erstatt nåværende faner med denne økten",
  or: "ଏହି ସେସନ୍ ସହ ବର୍ତ୍ତମାନ ଟ୍ୟାବ୍ ବଦଳାନ୍ତୁ",
  pl: "Zastąp obecne karty tą sesją",
  ro: "Înlocuiește filele curente cu această sesiune",
  sk: "Nahradiť aktuálne karty touto reláciou",
  sl: "Zamenjaj trenutne zavihke s to sejo",
  sr: "Замени тренутне картице овом сесијом",
  sv: "Ersätt nuvarande flikar med denna session",
  sw: "Badilisha tabo za sasa na kikao hiki",
  ta: "தற்போதைய தாவல்களை இந்த அமர்வுடன் மாற்றவும்",
  te: "ఈ సెషన్‌తో ప్రస్తుత ట్యాబ్‌లను భర్తీ చేయండి",
  th: "แทนที่แท็บปัจจุบันด้วยเซสชันนี้",
  uk: "Замінити поточні вкладки цим сеансом",
  vi: "Thay thế các tab hiện tại bằng phiên này"
};

// --- invalidDomain ---
T.invalidDomain = {
  am: "ትክክለኛ ጎራ ያስገቡ (ለምሳሌ example.com)", bg: "Въведете валиден домейн (напр. example.com)",
  bn: "একটি বৈধ ডোমেইন লিখুন (যেমন example.com)", ca: "Introduïu un domini vàlid (p. ex. example.com)",
  cs: "Zadejte platnou doménu (např. example.com)", da: "Indtast et gyldigt domæne (f.eks. example.com)",
  el: "Εισάγετε έναν έγκυρο τομέα (π.χ. example.com)", et: "Sisestage kehtiv domeen (nt example.com)",
  fa: "یک دامنه معتبر وارد کنید (مثلاً example.com)", fi: "Syötä kelvollinen verkkotunnus (esim. example.com)",
  fil: "Maglagay ng valid na domain (hal. example.com)", gu: "માન્ય ડોમેન દાખલ કરો (દા.ત. example.com)",
  he: "הזן דומיין תקין (למשל example.com)", hr: "Unesite valjanu domenu (npr. example.com)",
  hu: "Adjon meg érvényes domaint (pl. example.com)", id: "Masukkan domain yang valid (mis. example.com)",
  kn: "ಮಾನ್ಯ ಡೊಮೇನ್ ನಮೂದಿಸಿ (ಉದಾ. example.com)", lt: "Įveskite tinkamą domeną (pvz. example.com)",
  lv: "Ievadiet derīgu domēnu (piem. example.com)", ml: "സാധുവായ ഡൊമെയ്ൻ നൽകുക (ഉദാ. example.com)",
  mr: "वैध डोमेन प्रविष्ट करा (उदा. example.com)", ms: "Masukkan domain yang sah (cth. example.com)",
  nb: "Skriv inn et gyldig domene (f.eks. example.com)", nl: "Voer een geldig domein in (bijv. example.com)",
  no: "Skriv inn et gyldig domene (f.eks. example.com)", or: "ଏକ ବୈଧ ଡୋମେନ୍ ପ୍ରବେଶ କରନ୍ତୁ (ଯଥା example.com)",
  pl: "Wpisz prawidłową domenę (np. example.com)", ro: "Introduceți un domeniu valid (de ex. example.com)",
  sk: "Zadajte platnú doménu (napr. example.com)", sl: "Vnesite veljavno domeno (npr. example.com)",
  sr: "Унесите важећи домен (нпр. example.com)", sv: "Ange en giltig domän (t.ex. example.com)",
  sw: "Weka kikoa halali (mfano example.com)", ta: "சரியான டொமைனை உள்ளிடவும் (எ.கா. example.com)",
  te: "చెల్లుబాటు అయ్యే డొమైన్ నమోదు చేయండి (ఉదా. example.com)", th: "กรุณาใส่โดเมนที่ถูกต้อง (เช่น example.com)",
  uk: "Введіть дійсний домен (наприклад, example.com)", vi: "Nhập tên miền hợp lệ (ví dụ: example.com)"
};

// --- extensionPage ---
T.extensionPage = {
  am: "ማስፋፊያ ገጽ", bg: "Страница на разширението", bn: "এক্সটেনশন পেজ",
  ca: "Pàgina de l'extensió", cs: "Stránka rozšíření", da: "Udvidelsesside",
  el: "Σελίδα επέκτασης", et: "Laienduse leht", fa: "صفحه افزونه",
  fi: "Laajennussivu", fil: "Pahina ng extension", gu: "એક્સ્ટેન્શન પેજ",
  he: "דף התוסף", hr: "Stranica proširenja", hu: "Bővítmény oldala",
  id: "Halaman ekstensi", kn: "ವಿಸ್ತರಣೆ ಪುಟ", lt: "Plėtinio puslapis",
  lv: "Paplašinājuma lapa", ml: "എക്സ്റ്റൻഷൻ പേജ്", mr: "विस्तार पृष्ठ",
  ms: "Halaman sambungan", nb: "Utvidelsesside", nl: "Extensiepagina",
  no: "Utvidelsesside", or: "ଏକ୍ସଟେନସନ ପୃଷ୍ଠା", pl: "Strona rozszerzenia",
  ro: "Pagina extensiei", sk: "Stránka rozšírenia", sl: "Stran razširitve",
  sr: "Страница додатка", sv: "Tilläggssida", sw: "Ukurasa wa kiendelezi",
  ta: "நீட்டிப்பு பக்கம்", te: "ఎక్స్‌టెన్షన్ పేజీ", th: "หน้าส่วนขยาย",
  uk: "Сторінка розширення", vi: "Trang tiện ích mở rộng"
};

// --- exportWhitelist ---
T.exportWhitelist = {
  am: "ወደ ውጭ ላክ", bg: "Експортиране", bn: "রপ্তানি", ca: "Exporta",
  cs: "Exportovat", da: "Eksportér", el: "Εξαγωγή", et: "Ekspordi",
  fa: "صدور", fi: "Vie", fil: "I-export", gu: "નિકાસ",
  he: "ייצוא", hr: "Izvezi", hu: "Exportálás", id: "Ekspor",
  kn: "ರಫ್ತು", lt: "Eksportuoti", lv: "Eksportēt", ml: "എക്സ്പോർട്ട്",
  mr: "निर्यात", ms: "Eksport", nb: "Eksporter", nl: "Exporteren",
  no: "Eksporter", or: "ରପ୍ତାନି", pl: "Eksportuj", ro: "Exportă",
  sk: "Exportovať", sl: "Izvozi", sr: "Извези", sv: "Exportera",
  sw: "Hamisha nje", ta: "ஏற்றுமதி", te: "ఎగుమతి", th: "ส่งออก",
  uk: "Експорт", vi: "Xuất"
};

// --- importWhitelist ---
T.importWhitelist = {
  am: "አስገባ", bg: "Импортиране", bn: "আমদানি", ca: "Importa",
  cs: "Importovat", da: "Importér", el: "Εισαγωγή", et: "Impordi",
  fa: "واردات", fi: "Tuo", fil: "I-import", gu: "આયાત",
  he: "ייבוא", hr: "Uvezi", hu: "Importálás", id: "Impor",
  kn: "ಆಮದು", lt: "Importuoti", lv: "Importēt", ml: "ഇംപോർട്ട്",
  mr: "आयात", ms: "Import", nb: "Importer", nl: "Importeren",
  no: "Importer", or: "ଆମଦାନୀ", pl: "Importuj", ro: "Importă",
  sk: "Importovať", sl: "Uvozi", sr: "Увези", sv: "Importera",
  sw: "Ingiza", ta: "இறக்குமதி", te: "దిగుమతి", th: "นำเข้า",
  uk: "Імпорт", vi: "Nhập"
};

// --- exportWhitelistTitle ---
T.exportWhitelistTitle = {
  am: "ነጭ ዝርዝር ቅዳ", bg: "Копиране на белия списък", bn: "হোয়াইটলিস্ট কপি করুন",
  ca: "Copia la llista blanca", cs: "Kopírovat seznam povolených", da: "Kopiér hvidliste",
  el: "Αντιγραφή λευκής λίστας", et: "Kopeeri lubatavate nimekiri", fa: "کپی لیست سفید",
  fi: "Kopioi sallittujen lista", fil: "Kopyahin ang whitelist", gu: "વ્હાઇટલિસ્ટ કૉપિ કરો",
  he: "העתק רשימת היתרים", hr: "Kopiraj bijelu listu", hu: "Engedélyezési lista másolása",
  id: "Salin daftar putih", kn: "ಶ್ವೇತಪಟ್ಟಿ ನಕಲಿಸಿ", lt: "Kopijuoti baltąjį sąrašą",
  lv: "Kopēt balto sarakstu", ml: "വൈറ്റ്‌ലിസ്റ്റ് പകർത്തുക", mr: "श्वेतसूची कॉपी करा",
  ms: "Salin senarai putih", nb: "Kopier hviteliste", nl: "Witte lijst kopiëren",
  no: "Kopier hviteliste", or: "ଧଳା ତାଲିକା କପି କରନ୍ତୁ", pl: "Kopiuj białą listę",
  ro: "Copiază lista albă", sk: "Kopírovať biely zoznam", sl: "Kopiraj beli seznam",
  sr: "Копирај белу листу", sv: "Kopiera vitlista", sw: "Nakili orodha nyeupe",
  ta: "அனுமதிப் பட்டியலை நகலெடு", te: "వైట్‌లిస్ట్ కాపీ చేయండి", th: "คัดลอกรายการที่อนุญาต",
  uk: "Копіювати білий список", vi: "Sao chép danh sách trắng"
};

// --- importWhitelistTitle ---
T.importWhitelistTitle = {
  am: "ከቅንጥብ ሰሌዳ ነጭ ዝርዝር አስገባ", bg: "Импортиране на белия списък от клипборда",
  bn: "ক্লিপবোর্ড থেকে হোয়াইটলিস্ট আমদানি করুন", ca: "Importa la llista blanca des del porta-retalls",
  cs: "Importovat seznam povolených ze schránky", da: "Importér hvidliste fra udklipsholder",
  el: "Εισαγωγή λευκής λίστας από πρόχειρο", et: "Impordi lubatavate nimekiri lõikelaualt",
  fa: "واردات لیست سفید از کلیپ‌بورد", fi: "Tuo sallittujen lista leikepöydältä",
  fil: "I-import ang whitelist mula sa clipboard", gu: "ક્લિપબોર્ડમાંથી વ્હાઇટલિસ્ટ આયાત કરો",
  he: "ייבוא רשימת היתרים מהלוח", hr: "Uvezi bijelu listu iz međuspremnika",
  hu: "Engedélyezési lista importálása vágólapról", id: "Impor daftar putih dari papan klip",
  kn: "ಕ್ಲಿಪ್‌ಬೋರ್ಡ್‌ನಿಂದ ಶ್ವೇತಪಟ್ಟಿ ಆಮದಿಸಿ", lt: "Importuoti baltąjį sąrašą iš iškarpinės",
  lv: "Importēt balto sarakstu no starpliktuves", ml: "ക്ലിപ്പ്ബോർഡിൽ നിന്ന് വൈറ്റ്‌ലിസ്റ്റ് ഇംപോർട്ട് ചെയ്യുക",
  mr: "क्लिपबोर्डमधून श्वेतसूची आयात करा", ms: "Import senarai putih dari papan klip",
  nb: "Importer hviteliste fra utklippstavle", nl: "Witte lijst importeren van klembord",
  no: "Importer hviteliste fra utklippstavle", or: "କ୍ଲିପବୋର୍ଡରୁ ଧଳା ତାଲିକା ଆମଦାନୀ କରନ୍ତୁ",
  pl: "Importuj białą listę ze schowka", ro: "Importă lista albă din clipboard",
  sk: "Importovať biely zoznam zo schránky", sl: "Uvozi beli seznam iz odložišča",
  sr: "Увези белу листу из оставе", sv: "Importera vitlista från urklipp",
  sw: "Ingiza orodha nyeupe kutoka kwenye ubao wa kunakili", ta: "கிளிப்போர்டிலிருந்து அனுமதிப் பட்டியலை இறக்குமதி செய்",
  te: "క్లిప్‌బోర్డ్ నుండి వైట్‌లిస్ట్ దిగుమతి చేయండి", th: "นำเข้ารายการที่อนุญาตจากคลิปบอร์ด",
  uk: "Імпортувати білий список з буфера обміну", vi: "Nhập danh sách trắng từ bộ nhớ tạm"
};

// --- copiedSites (has placeholder) ---
T.copiedSites = {
  am: "ተቀዱ $COUNT$ ድረ-ገጽ(ዎች)", bg: "Копирани $COUNT$ сайт(а)", bn: "$COUNT$ সাইট কপি করা হয়েছে",
  ca: "$COUNT$ lloc(s) copiat(s)", cs: "Zkopírováno $COUNT$ stránek", da: "$COUNT$ websted(er) kopieret",
  el: "Αντιγράφηκαν $COUNT$ ιστότοπος(-οι)", et: "Kopeeritud $COUNT$ saiti", fa: "$COUNT$ سایت کپی شد",
  fi: "$COUNT$ sivustoa kopioitu", fil: "Nakopya ang $COUNT$ site(s)", gu: "$COUNT$ સાઇટ(ટ્સ) કૉપિ કર્યા",
  he: "הועתקו $COUNT$ אתרים", hr: "Kopirano $COUNT$ stranica", hu: "$COUNT$ webhely másolva",
  id: "$COUNT$ situs disalin", kn: "$COUNT$ ಸೈಟ್(ಗಳು) ನಕಲಿಸಲಾಗಿದೆ", lt: "Nukopijuota $COUNT$ svetainių",
  lv: "Nokopēts(-i) $COUNT$ vietne(-es)", ml: "$COUNT$ സൈറ്റ്(കൾ) പകർത്തി", mr: "$COUNT$ साइट कॉपी केली",
  ms: "$COUNT$ laman disalin", nb: "$COUNT$ nettsted(er) kopiert", nl: "$COUNT$ site(s) gekopieerd",
  no: "$COUNT$ nettsted(er) kopiert", or: "$COUNT$ ସାଇଟ୍ କପି ହେଲା", pl: "Skopiowano $COUNT$ stron",
  ro: "$COUNT$ site(-uri) copiat(e)", sk: "Skopírovaných $COUNT$ stránok", sl: "Kopiranih $COUNT$ strani",
  sr: "Копирано $COUNT$ сајтова", sv: "$COUNT$ webbplats(er) kopierad(e)", sw: "Imenakiliwa tovuti $COUNT$",
  ta: "$COUNT$ தளம்(கள்) நகலெடுக்கப்பட்டன", te: "$COUNT$ సైట్(లు) కాపీ చేయబడ్డాయి",
  th: "คัดลอกแล้ว $COUNT$ เว็บไซต์", uk: "Скопійовано $COUNT$ сайт(ів)", vi: "Đã sao chép $COUNT$ trang web"
};

// --- importedSites (has placeholder) ---
T.importedSites = {
  am: "ተመጡ $COUNT$ አዲስ ድረ-ገጽ(ዎች)", bg: "Импортирани $COUNT$ нов(и) сайт(а)",
  bn: "$COUNT$ নতুন সাইট আমদানি করা হয়েছে", ca: "$COUNT$ lloc(s) nou(s) importat(s)",
  cs: "Importováno $COUNT$ nových stránek", da: "$COUNT$ nye websted(er) importeret",
  el: "Εισήχθησαν $COUNT$ νέος(-οι) ιστότοπος(-οι)", et: "Imporditud $COUNT$ uut saiti",
  fa: "$COUNT$ سایت جدید وارد شد", fi: "$COUNT$ uutta sivustoa tuotu", fil: "Na-import ang $COUNT$ bagong site(s)",
  gu: "$COUNT$ નવા સાઇટ(ટ્સ) આયાત થયા", he: "יובאו $COUNT$ אתרים חדשים",
  hr: "Uvezeno $COUNT$ novih stranica", hu: "$COUNT$ új webhely importálva",
  id: "$COUNT$ situs baru diimpor", kn: "$COUNT$ ಹೊಸ ಸೈಟ್(ಗಳು) ಆಮದಿಸಲಾಗಿದೆ",
  lt: "Importuota $COUNT$ naujų svetainių", lv: "Importēts(-i) $COUNT$ jauna(-as) vietne(-es)",
  ml: "$COUNT$ പുതിയ സൈറ്റ്(കൾ) ഇംപോർട്ട് ചെയ്തു", mr: "$COUNT$ नवीन साइट आयात केली",
  ms: "$COUNT$ laman baharu diimport", nb: "$COUNT$ nye nettsted(er) importert",
  nl: "$COUNT$ nieuwe site(s) geïmporteerd", no: "$COUNT$ nye nettsted(er) importert",
  or: "$COUNT$ ନୂଆ ସାଇଟ୍ ଆମଦାନୀ ହେଲା", pl: "Zaimportowano $COUNT$ nowych stron",
  ro: "$COUNT$ site(-uri) noi importat(e)", sk: "Importovaných $COUNT$ nových stránok",
  sl: "Uvoženih $COUNT$ novih strani", sr: "Увезено $COUNT$ нових сајтова",
  sv: "$COUNT$ ny(a) webbplats(er) importerad(e)", sw: "Imeingizwa tovuti $COUNT$ mpya",
  ta: "$COUNT$ புதிய தளம்(கள்) இறக்குமதி செய்யப்பட்டன", te: "$COUNT$ కొత్త సైట్(లు) దిగుమతి చేయబడ్డాయి",
  th: "นำเข้าแล้ว $COUNT$ เว็บไซต์ใหม่", uk: "Імпортовано $COUNT$ новий(их) сайт(ів)",
  vi: "Đã nhập $COUNT$ trang web mới"
};

// --- noValidDomains ---
T.noValidDomains = {
  am: "በቅንጥብ ሰሌዳ ውስጥ ትክክለኛ ጎራ አልተገኘም", bg: "Не са намерени валидни домейни в клипборда",
  bn: "ক্লিপবোর্ডে কোনো বৈধ ডোমেইন পাওয়া যায়নি", ca: "No s'han trobat dominis vàlids al porta-retalls",
  cs: "Ve schránce nebyly nalezeny žádné platné domény", da: "Ingen gyldige domæner fundet i udklipsholder",
  el: "Δεν βρέθηκαν έγκυροι τομείς στο πρόχειρο", et: "Lõikelaualt ei leitud kehtivaid domeene",
  fa: "دامنه معتبری در کلیپ‌بورد یافت نشد", fi: "Leikepöydältä ei löytynyt kelvollisia verkkotunnuksia",
  fil: "Walang nahanap na valid na domain sa clipboard", gu: "ક્લિપબોર્ડમાં કોઈ માન્ય ડોમેન મળ્યું નથી",
  he: "לא נמצאו דומיינים תקינים בלוח", hr: "U međuspremniku nisu pronađene valjane domene",
  hu: "Nem találhatók érvényes domainek a vágólapon", id: "Tidak ada domain valid ditemukan di papan klip",
  kn: "ಕ್ಲಿಪ್‌ಬೋರ್ಡ್‌ನಲ್ಲಿ ಮಾನ್ಯ ಡೊಮೇನ್‌ಗಳು ಕಂಡುಬಂದಿಲ್ಲ", lt: "Iškarpinėje nerasta tinkamų domenų",
  lv: "Starpliktuvē nav atrasti derīgi domēni", ml: "ക്ലിപ്പ്ബോർഡിൽ സാധുവായ ഡൊമെയ്‌നുകൾ കണ്ടെത്തിയില്ല",
  mr: "क्लिपबोर्डमध्ये वैध डोमेन सापडले नाहीत", ms: "Tiada domain sah ditemui dalam papan klip",
  nb: "Ingen gyldige domener funnet i utklippstavle", nl: "Geen geldige domeinen gevonden op klembord",
  no: "Ingen gyldige domener funnet i utklippstavle", or: "କ୍ଲିପବୋର୍ଡରେ କୌଣସି ବୈଧ ଡୋମେନ୍ ମିଳିଲା ନାହିଁ",
  pl: "Nie znaleziono prawidłowych domen w schowku", ro: "Nu s-au găsit domenii valide în clipboard",
  sk: "V schránke sa nenašli žiadne platné domény", sl: "V odložišču ni veljavnih domen",
  sr: "У остави нису пронађени важећи домени", sv: "Inga giltiga domäner hittades i urklipp",
  sw: "Hakuna kikoa halali kilichopatikana kwenye ubao wa kunakili",
  ta: "கிளிப்போர்டில் சரியான டொமைன்கள் கிடைக்கவில்லை", te: "క్లిప్‌బోర్డ్‌లో చెల్లుబాటు అయ్యే డొమైన్‌లు కనుగొనబడలేదు",
  th: "ไม่พบโดเมนที่ถูกต้องในคลิปบอร์ด", uk: "У буфері обміну не знайдено дійсних доменів",
  vi: "Không tìm thấy tên miền hợp lệ trong bộ nhớ tạm"
};

// --- clipboardReadFailed ---
T.clipboardReadFailed = {
  am: "ቅንጥብ ሰሌዳውን ማንበብ አልተቻለም", bg: "Не може да се прочете клипборда",
  bn: "ক্লিপবোর্ড পড়া যায়নি", ca: "No s'ha pogut llegir el porta-retalls",
  cs: "Nelze přečíst schránku", da: "Kunne ikke læse udklipsholder",
  el: "Αδυναμία ανάγνωσης προχείρου", et: "Lõikelauda ei saanud lugeda",
  fa: "خواندن کلیپ‌بورد ممکن نشد", fi: "Leikepöytää ei voitu lukea",
  fil: "Hindi mabasa ang clipboard", gu: "ક્લિપબોર્ડ વાંચી શકાયું નહીં",
  he: "לא ניתן לקרוא את הלוח", hr: "Nije moguće pročitati međuspremnik",
  hu: "Nem sikerült olvasni a vágólapot", id: "Tidak dapat membaca papan klip",
  kn: "ಕ್ಲಿಪ್‌ಬೋರ್ಡ್ ಓದಲಾಗಲಿಲ್ಲ", lt: "Nepavyko nuskaityti iškarpinės",
  lv: "Neizdevās nolasīt starpliktuvi", ml: "ക്ലിപ്പ്ബോർഡ് വായിക്കാൻ കഴിഞ്ഞില്ല",
  mr: "क्लिपबोर्ड वाचता आले नाही", ms: "Tidak dapat membaca papan klip",
  nb: "Kunne ikke lese utklippstavle", nl: "Klembord kon niet worden gelezen",
  no: "Kunne ikke lese utklippstavle", or: "କ୍ଲିପବୋର୍ଡ ପଢ଼ି ହେଲା ନାହିଁ",
  pl: "Nie można odczytać schowka", ro: "Nu s-a putut citi clipboard-ul",
  sk: "Nepodarilo sa prečítať schránku", sl: "Odložišča ni bilo mogoče prebrati",
  sr: "Није могуће прочитати оставу", sv: "Kunde inte läsa urklipp",
  sw: "Haikuweza kusoma ubao wa kunakili", ta: "கிளிப்போர்டைப் படிக்க இயலவில்லை",
  te: "క్లిప్‌బోర్డ్ చదవడం సాధ్యం కాలేదు", th: "ไม่สามารถอ่านคลิปบอร์ดได้",
  uk: "Не вдалося прочитати буфер обміну", vi: "Không thể đọc bộ nhớ tạm"
};

// --- enjoyingDrowzy ---
T.enjoyingDrowzy = {
  am: "Drowzy ይወዳሉ?", bg: "Харесва ли ви Drowzy?", bn: "Drowzy পছন্দ হচ্ছে?",
  ca: "T'agrada Drowzy?", cs: "Líbí se vám Drowzy?", da: "Kan du lide Drowzy?",
  el: "Σας αρέσει το Drowzy;", et: "Kas Drowzy meeldib?", fa: "از Drowzy لذت می‌برید؟",
  fi: "Pidätkö Drowzystä?", fil: "Nae-enjoy mo ba ang Drowzy?", gu: "Drowzy ગમે છે?",
  he: "נהנים מ-Drowzy?", hr: "Sviđa li vam se Drowzy?", hu: "Tetszik a Drowzy?",
  id: "Menyukai Drowzy?", kn: "Drowzy ಇಷ್ಟವಾಗುತ್ತಿದೆಯೇ?", lt: "Patinka Drowzy?",
  lv: "Vai Drowzy patīk?", ml: "Drowzy ഇഷ്ടമാകുന്നുണ്ടോ?", mr: "Drowzy आवडत आहे?",
  ms: "Suka Drowzy?", nb: "Liker du Drowzy?", nl: "Bevalt Drowzy?",
  no: "Liker du Drowzy?", or: "Drowzy ପସନ୍ଦ କରୁଛନ୍ତି?", pl: "Podoba Ci się Drowzy?",
  ro: "Îți place Drowzy?", sk: "Páči sa vám Drowzy?", sl: "Vam je Drowzy všeč?",
  sr: "Свиђа ли вам се Drowzy?", sv: "Gillar du Drowzy?", sw: "Unafurahia Drowzy?",
  ta: "Drowzy பிடிக்கிறதா?", te: "Drowzy నచ్చుతోందా?", th: "ชอบ Drowzy ไหม?",
  uk: "Подобається Drowzy?", vi: "Bạn thích Drowzy không?"
};

// --- reviewYes ---
T.reviewYes = {
  am: "አዎ!", bg: "Да!", bn: "হ্যাঁ!", ca: "Sí!", cs: "Ano!", da: "Ja!",
  el: "Ναι!", et: "Jah!", fa: "بله!", fi: "Kyllä!", fil: "Oo!", gu: "હા!",
  he: "!כן", hr: "Da!", hu: "Igen!", id: "Ya!", kn: "ಹೌದು!", lt: "Taip!",
  lv: "Jā!", ml: "അതെ!", mr: "हो!", ms: "Ya!", nb: "Ja!", nl: "Ja!",
  no: "Ja!", or: "ହଁ!", pl: "Tak!", ro: "Da!", sk: "Áno!", sl: "Da!",
  sr: "Да!", sv: "Ja!", sw: "Ndiyo!", ta: "ஆமாம்!", te: "అవును!", th: "ใช่!",
  uk: "Так!", vi: "Có!"
};

// --- reviewNo ---
T.reviewNo = {
  am: "ብዙም አይደለም", bg: "Не особено", bn: "তেমন নয়", ca: "No gaire",
  cs: "Ne moc", da: "Ikke rigtig", el: "Όχι ιδιαίτερα", et: "Mitte eriti",
  fa: "نه واقعاً", fi: "Ei oikeastaan", fil: "Hindi naman", gu: "ખરેખર નહીં",
  he: "לא ממש", hr: "Ne baš", hu: "Nem igazán", id: "Tidak juga",
  kn: "ಅಷ್ಟಾಗಿ ಇಲ್ಲ", lt: "Ne visai", lv: "Ne īsti", ml: "അത്ര ഇല്ല",
  mr: "फार नाही", ms: "Tidak juga", nb: "Ikke egentlig", nl: "Niet echt",
  no: "Ikke egentlig", or: "ସେତିକି ନୁହେଁ", pl: "Nie bardzo", ro: "Nu prea",
  sk: "Nie celkom", sl: "Ne ravno", sr: "Не баш", sv: "Inte riktigt",
  sw: "Si sana", ta: "அவ்வளவாக இல்லை", te: "అంతగా కాదు", th: "ไม่เชิง",
  uk: "Не дуже", vi: "Không hẳn"
};

// --- whatsNew ---
T.whatsNew = {
  am: "በ v1.1.0 ውስጥ አዲስ", bg: "Какво ново в v1.1.0", bn: "v1.1.0-এ নতুন কী",
  ca: "Novetats a la v1.1.0", cs: "Co je nového ve v1.1.0", da: "Nyheder i v1.1.0",
  el: "Τι νέο στη v1.1.0", et: "Mis on uut versioonis 1.1.0", fa: "تازه‌ها در v1.1.0",
  fi: "Uutta versiossa 1.1.0", fil: "Ano ang bago sa v1.1.0", gu: "v1.1.0 માં નવું શું છે",
  he: "מה חדש ב-v1.1.0", hr: "Što je novo u v1.1.0", hu: "Újdonságok a v1.1.0-ban",
  id: "Yang baru di v1.1.0", kn: "v1.1.0 ರಲ್ಲಿ ಹೊಸದೇನು", lt: "Kas naujo v1.1.0",
  lv: "Kas jauns v1.1.0", ml: "v1.1.0-ൽ പുതിയത്", mr: "v1.1.0 मधील नवीन",
  ms: "Apa yang baharu dalam v1.1.0", nb: "Hva er nytt i v1.1.0", nl: "Nieuw in v1.1.0",
  no: "Hva er nytt i v1.1.0", or: "v1.1.0 ରେ ନୂଆ କଣ", pl: "Co nowego w v1.1.0",
  ro: "Ce e nou în v1.1.0", sk: "Čo je nové vo v1.1.0", sl: "Kaj je novega v v1.1.0",
  sr: "Шта је ново у v1.1.0", sv: "Nyheter i v1.1.0", sw: "Nini kipya katika v1.1.0",
  ta: "v1.1.0 இல் புதியவை", te: "v1.1.0 లో కొత్తవి", th: "มีอะไรใหม่ใน v1.1.0",
  uk: "Що нового у v1.1.0", vi: "Có gì mới trong v1.1.0"
};

// --- Changelog keys ---
T.changelogTitle = { am: "Drowzy ውስጥ አዲስ ነገር", bg: "Какво ново в Drowzy", bn: "Drowzy-তে নতুন কী", ca: "Novetats de Drowzy", cs: "Co je nového v Drowzy", da: "Nyheder i Drowzy", el: "Τι νέο στο Drowzy", et: "Mis on Drowzys uut", fa: "تازه‌های Drowzy", fi: "Uutta Drowzyssä", fil: "Ano ang Bago sa Drowzy", gu: "Drowzy માં નવું શું છે", he: "מה חדש ב-Drowzy", hr: "Što je novo u Drowzy", hu: "Újdonságok a Drowzy-ban", id: "Yang Baru di Drowzy", kn: "Drowzy ನಲ್ಲಿ ಹೊಸದೇನು", lt: "Kas naujo Drowzy", lv: "Kas jauns Drowzy", ml: "Drowzy-ൽ പുതിയത്", mr: "Drowzy मधील नवीन", ms: "Apa yang Baharu di Drowzy", nb: "Hva er nytt i Drowzy", nl: "Nieuw in Drowzy", no: "Hva er nytt i Drowzy", or: "Drowzy ରେ ନୂଆ କଣ", pl: "Co nowego w Drowzy", ro: "Ce e nou în Drowzy", sk: "Čo je nové v Drowzy", sl: "Kaj je novega v Drowzy", sr: "Шта је ново у Drowzy", sv: "Nyheter i Drowzy", sw: "Nini Kipya katika Drowzy", ta: "Drowzy இல் புதியவை", te: "Drowzy లో కొత్తవి", th: "มีอะไรใหม่ใน Drowzy", uk: "Що нового в Drowzy", vi: "Có gì mới trong Drowzy" };

T.changelogWhatsNew = { am: "አዲስ ነገር", bg: "Какво ново", bn: "নতুন কী", ca: "Novetats", cs: "Co je nového", da: "Nyheder", el: "Τι νέο", et: "Mis on uut", fa: "تازه‌ها", fi: "Uutta", fil: "Ano ang Bago", gu: "નવું શું છે", he: "מה חדש", hr: "Što je novo", hu: "Újdonságok", id: "Yang Baru", kn: "ಹೊಸದೇನು", lt: "Kas naujo", lv: "Kas jauns", ml: "പുതിയത്", mr: "नवीन", ms: "Apa yang Baharu", nb: "Hva er nytt", nl: "Nieuw", no: "Hva er nytt", or: "ନୂଆ କଣ", pl: "Co nowego", ro: "Ce e nou", sk: "Čo je nové", sl: "Kaj je novega", sr: "Шта је ново", sv: "Nyheter", sw: "Nini Kipya", ta: "புதியவை", te: "కొత్తవి", th: "มีอะไรใหม่", uk: "Що нового", vi: "Có gì mới" };

T.changelogVersion = { am: "ስሪት 1.1.0", bg: "Версия 1.1.0", bn: "সংস্করণ 1.1.0", ca: "Versió 1.1.0", cs: "Verze 1.1.0", da: "Version 1.1.0", el: "Έκδοση 1.1.0", et: "Versioon 1.1.0", fa: "نسخه 1.1.0", fi: "Versio 1.1.0", fil: "Bersyon 1.1.0", gu: "સંસ્કરણ 1.1.0", he: "גרסה 1.1.0", hr: "Verzija 1.1.0", hu: "Verzió 1.1.0", id: "Versi 1.1.0", kn: "ಆವೃತ್ತಿ 1.1.0", lt: "Versija 1.1.0", lv: "Versija 1.1.0", ml: "പതിപ്പ് 1.1.0", mr: "आवृत्ती 1.1.0", ms: "Versi 1.1.0", nb: "Versjon 1.1.0", nl: "Versie 1.1.0", no: "Versjon 1.1.0", or: "ସଂସ୍କରଣ 1.1.0", pl: "Wersja 1.1.0", ro: "Versiunea 1.1.0", sk: "Verzia 1.1.0", sl: "Različica 1.1.0", sr: "Верзија 1.1.0", sv: "Version 1.1.0", sw: "Toleo 1.1.0", ta: "பதிப்பு 1.1.0", te: "వెర్షన్ 1.1.0", th: "เวอร์ชัน 1.1.0", uk: "Версія 1.1.0", vi: "Phiên bản 1.1.0" };

T.changelogNewFeatures = { am: "አዲስ ባህሪያት", bg: "Нови функции", bn: "নতুন বৈশিষ্ট্য", ca: "Noves funcionalitats", cs: "Nové funkce", da: "Nye funktioner", el: "Νέα χαρακτηριστικά", et: "Uued funktsioonid", fa: "ویژگی‌های جدید", fi: "Uudet ominaisuudet", fil: "Mga Bagong Feature", gu: "નવી સુવિધાઓ", he: "תכונות חדשות", hr: "Nove značajke", hu: "Új funkciók", id: "Fitur Baru", kn: "ಹೊಸ ವೈಶಿಷ್ಟ್ಯಗಳು", lt: "Naujos funkcijos", lv: "Jaunas iespējas", ml: "പുതിയ ഫീച്ചറുകൾ", mr: "नवीन वैशिष्ट्ये", ms: "Ciri Baharu", nb: "Nye funksjoner", nl: "Nieuwe functies", no: "Nye funksjoner", or: "ନୂଆ ବୈଶିଷ୍ଟ୍ୟ", pl: "Nowe funkcje", ro: "Funcții noi", sk: "Nové funkcie", sl: "Nove funkcije", sr: "Нове функције", sv: "Nya funktioner", sw: "Vipengele Vipya", ta: "புதிய அம்சங்கள்", te: "కొత్త ఫీచర్లు", th: "ฟีเจอร์ใหม่", uk: "Нові функції", vi: "Tính năng mới" };

T.changelogBugFixes = { am: "ስህተት ማስተካከያ", bg: "Корекции", bn: "বাগ সমাধান", ca: "Correccions", cs: "Opravy chyb", da: "Fejlrettelser", el: "Διορθώσεις σφαλμάτων", et: "Veaparandused", fa: "رفع اشکال", fi: "Virheenkorjaukset", fil: "Mga Pag-aayos ng Bug", gu: "બગ ફિક્સ", he: "תיקוני באגים", hr: "Popravci grešaka", hu: "Hibajavítások", id: "Perbaikan Bug", kn: "ದೋಷ ಸರಿಪಡಿಸುವಿಕೆಗಳು", lt: "Klaidų taisymai", lv: "Kļūdu labojumi", ml: "ബഗ് പരിഹാരങ്ങൾ", mr: "बग दुरुस्त्या", ms: "Pembaikan Pepijat", nb: "Feilrettinger", nl: "Bugfixes", no: "Feilrettinger", or: "ବଗ୍ ସମାଧାନ", pl: "Poprawki błędów", ro: "Remedieri", sk: "Opravy chýb", sl: "Popravki napak", sr: "Исправке грешака", sv: "Buggfixar", sw: "Marekebisho ya Hitilafu", ta: "பிழைத் திருத்தங்கள்", te: "బగ్ ఫిక్స్‌లు", th: "แก้ไขข้อบกพร่อง", uk: "Виправлення помилок", vi: "Sửa lỗi" };

T.changelogImprovements = { am: "ማሻሻያዎች", bg: "Подобрения", bn: "উন্নতি", ca: "Millores", cs: "Vylepšení", da: "Forbedringer", el: "Βελτιώσεις", et: "Täiustused", fa: "بهبودها", fi: "Parannukset", fil: "Mga Pagpapabuti", gu: "સુધારાઓ", he: "שיפורים", hr: "Poboljšanja", hu: "Fejlesztések", id: "Peningkatan", kn: "ಸುಧಾರಣೆಗಳು", lt: "Patobulinimai", lv: "Uzlabojumi", ml: "മെച്ചപ്പെടുത്തലുകൾ", mr: "सुधारणा", ms: "Penambahbaikan", nb: "Forbedringer", nl: "Verbeteringen", no: "Forbedringer", or: "ଉନ୍ନତି", pl: "Ulepszenia", ro: "Îmbunătățiri", sk: "Vylepšenia", sl: "Izboljšave", sr: "Побољшања", sv: "Förbättringar", sw: "Maboresho", ta: "மேம்பாடுகள்", te: "మెరుగుదలలు", th: "การปรับปรุง", uk: "Покращення", vi: "Cải tiến" };

T.changelogReviewPromptTitle = { am: "ግምገማ ጥያቄ", bg: "Заявка за рецензия", bn: "পর্যালোচনা অনুরোধ", ca: "Sol·licitud de ressenya", cs: "Žádost o recenzi", da: "Anmeldelsesanmodning", el: "Αίτημα αξιολόγησης", et: "Arvustuse päring", fa: "درخواست بررسی", fi: "Arvostelukehotus", fil: "Paghingi ng Review", gu: "સમીક્ષા વિનંતી", he: "בקשת ביקורת", hr: "Zahtjev za recenziju", hu: "Értékelés kérése", id: "Permintaan Ulasan", kn: "ವಿಮರ್ಶೆ ವಿನಂತಿ", lt: "Atsiliepimo užklausa", lv: "Atsauksmes pieprasījums", ml: "അവലോകന അഭ്യർത്ഥന", mr: "पुनरावलोकन विनंती", ms: "Permintaan Ulasan", nb: "Anmeldelsesforespørsel", nl: "Beoordelingsverzoek", no: "Anmeldelsesforespørsel", or: "ସମୀକ୍ଷା ଅନୁରୋଧ", pl: "Prośba o opinię", ro: "Solicitare de recenzie", sk: "Žiadosť o recenziu", sl: "Prošnja za oceno", sr: "Захтев за рецензију", sv: "Omdömesförfrågan", sw: "Ombi la Ukaguzi", ta: "மதிப்பாய்வு கோரிக்கை", te: "సమీక్ష అభ్యర్థన", th: "ขอรีวิว", uk: "Запит на відгук", vi: "Yêu cầu đánh giá" };

T.changelogReviewPromptDesc = { am: "ጥቂት ትሮችን ካገዱ በኋላ፣ Drowzy ይወዳሉ እንደሆነ ይጠይቃል። ፈጣን የአውራ ጣት ወደ ላይ ብዙ ይረዳናል!", bg: "След като спрете няколко раздела, Drowzy ще попита дали ви харесва. Бърз палец нагоре ни помага много!", bn: "কয়েকটি ট্যাব সাসপেন্ড করার পর, Drowzy আপনাকে জিজ্ঞেস করবে। একটি দ্রুত থাম্বস আপ আমাদের অনেক সাহায্য করে!", ca: "Després de suspendre unes quantes pestanyes, Drowzy us preguntarà si us agrada. Un polze amunt ens ajuda molt!", cs: "Po uspání několika karet se Drowzy zeptá, jestli se vám líbí. Rychlý palec nahoru nám hodně pomůže!", da: "Efter at have suspenderet et par faner, vil Drowzy spørge om du kan lide den. Et hurtigt thumbs up hjælper os meget!", el: "Αφού αναστείλετε μερικές καρτέλες, το Drowzy θα ρωτήσει αν σας αρέσει. Ένα γρήγορο thumbs up μας βοηθάει πολύ!", et: "Pärast mõne vahelehe peatamist küsib Drowzy, kas see meeldib. Kiire pöidla üles aitab meid palju!", fa: "پس از تعلیق چند تب، Drowzy از شما می‌پرسد آیا لذت می‌برید. یک لایک سریع خیلی به ما کمک می‌کند!", fi: "Muutaman välilehden keskeytettyäsi Drowzy kysyy, pidätkö siitä. Nopea peukku ylös auttaa meitä paljon!", fil: "Pagkatapos i-suspend ang ilang tab, magtatanong ang Drowzy kung gusto mo ito. Isang mabilis na thumbs up ay nakakatulong sa amin!", gu: "થોડા ટૅબ્સ સસ્પેન્ડ કર્યા પછી, Drowzy પૂછશે કે તમે તેનો આનંદ માણો છો. એક ઝડપી થમ્બ્સ અપ અમને ઘણી મદદ કરે છે!", he: "אחרי שתשהו כמה כרטיסיות, Drowzy ישאל אם אתם נהנים. לייק מהיר עוזר לנו המון!", hr: "Nakon što suspendirate nekoliko kartica, Drowzy će pitati sviđa li vam se. Brzi palac gore nam puno pomaže!", hu: "Néhány lap felfüggesztése után a Drowzy megkérdezi, tetszik-e. Egy gyors felfelé mutató hüvelykujj sokat segít!", id: "Setelah menangguhkan beberapa tab, Drowzy akan bertanya apakah Anda menyukainya. Jempol cepat sangat membantu kami!", kn: "ಕೆಲವು ಟ್ಯಾಬ್‌ಗಳನ್ನು ಸ್ಥಗಿತಗೊಳಿಸಿದ ನಂತರ, Drowzy ನಿಮಗೆ ಇಷ್ಟವಾಗುತ್ತಿದೆಯೇ ಎಂದು ಕೇಳುತ್ತದೆ. ತ್ವರಿತ ಥಂಬ್ಸ್ ಅಪ್ ನಮಗೆ ಬಹಳ ಸಹಾಯ ಮಾಡುತ್ತದೆ!", lt: "Pristabdžius kelis skirtukus, Drowzy paklaus, ar jums patinka. Greitas balsas labai mums padeda!", lv: "Pēc dažu ciļņu apturēšanas Drowzy pajautās, vai jums patīk. Ātrs īkšķis uz augšu mums ļoti palīdz!", ml: "കുറച്ച് ടാബുകൾ സസ്പെൻഡ് ചെയ്ത ശേഷം, Drowzy ഇഷ്ടമാകുന്നുണ്ടോ എന്ന് ചോദിക്കും. ഒരു ദ്രുത തംബ്സ് അപ് ഞങ്ങളെ വളരെ സഹായിക്കും!", mr: "काही टॅब सस्पेंड केल्यानंतर, Drowzy तुम्हाला विचारेल. एक जलद थम्स अप आम्हाला खूप मदत करतो!", ms: "Selepas menangguhkan beberapa tab, Drowzy akan bertanya sama ada anda suka. Ibu jari cepat ke atas sangat membantu kami!", nb: "Etter at du har suspendert noen faner, spør Drowzy om du liker den. En rask tommel opp hjelper oss mye!", nl: "Nadat je een paar tabbladen hebt opgeschort, vraagt Drowzy of je het leuk vindt. Een snelle duim omhoog helpt ons enorm!", no: "Etter at du har suspendert noen faner, spør Drowzy om du liker den. En rask tommel opp hjelper oss mye!", or: "କିଛି ଟ୍ୟାବ୍ ସ୍ଥଗିତ କରିବା ପରେ, Drowzy ଆପଣଙ୍କୁ ପଚାରିବ। ଏକ ଦ୍ରୁତ ଥମ୍ବସ୍ ଅପ୍ ଆମକୁ ବହୁତ ସାହାଯ୍ୟ କରେ!", pl: "Po uśpieniu kilku kart Drowzy zapyta, czy Ci się podoba. Szybki kciuk w górę bardzo nam pomaga!", ro: "După ce suspendați câteva file, Drowzy va întreba dacă vă place. Un like rapid ne ajută enorm!", sk: "Po uspávaní niekoľkých kariet sa Drowzy opýta, či sa vám páči. Rýchly palec hore nám veľmi pomôže!", sl: "Po zaustavitvi nekaj zavihkov vas bo Drowzy vprašal, ali vam je všeč. Hiter palec gor nam zelo pomaga!", sr: "Након суспендовања неколико картица, Drowzy ће питати да ли вам се свиђа. Брзи палац горе нам много помаже!", sv: "Efter att du har pausat några flikar kommer Drowzy fråga om du gillar den. Ett snabbt tummen upp hjälper oss mycket!", sw: "Baada ya kusimamisha tabo chache, Drowzy itauliza kama unaifurahia. Kidole cha haraka kinasaidia sana!", ta: "சில தாவல்களை இடைநிறுத்திய பிறகு, Drowzy உங்களிடம் கேட்கும். ஒரு விரைவான தம்ப்ஸ் அப் எங்களுக்கு மிகவும் உதவுகிறது!", te: "కొన్ని ట్యాబ్‌లను సస్పెండ్ చేసిన తర్వాత, Drowzy మీకు నచ్చుతోందా అని అడుగుతుంది. త్వరిత థంబ్స్ అప్ మాకు చాలా సహాయం చేస్తుంది!", th: "หลังจากระงับแท็บไม่กี่แท็บ Drowzy จะถามว่าคุณชอบหรือไม่ การกดถูกใจอย่างรวดเร็วช่วยเราได้มาก!", uk: "Після призупинення кількох вкладок Drowzy запитає, чи вам подобається. Швидкий лайк дуже нам допомагає!", vi: "Sau khi tạm ngưng một vài tab, Drowzy sẽ hỏi bạn có thích không. Một lượt thích nhanh giúp chúng tôi rất nhiều!" };

T.changelogChangelogTitle = { am: "የለውጥ ዝርዝር ገጽ", bg: "Страница на промените", bn: "পরিবর্তন লগ পৃষ্ঠা", ca: "Pàgina de canvis", cs: "Stránka změn", da: "Ændringslogside", el: "Σελίδα αλλαγών", et: "Muudatuste leht", fa: "صفحه تغییرات", fi: "Muutoslokisivu", fil: "Pahina ng Changelog", gu: "ફેરફાર લોગ પૃષ્ઠ", he: "דף שינויים", hr: "Stranica izmjena", hu: "Változásnapló oldal", id: "Halaman Perubahan", kn: "ಬದಲಾವಣೆ ಲಾಗ್ ಪುಟ", lt: "Pakeitimų puslapis", lv: "Izmaiņu lapa", ml: "മാറ്റ ലോഗ് പേജ്", mr: "बदल नोंदणी पृष्ठ", ms: "Halaman Log Perubahan", nb: "Endringsloggside", nl: "Wijzigingenpagina", no: "Endringsloggside", or: "ପରିବର୍ତ୍ତନ ଲଗ୍ ପୃଷ୍ଠା", pl: "Strona zmian", ro: "Pagina de modificări", sk: "Stránka zmien", sl: "Stran sprememb", sr: "Страница измена", sv: "Ändringsloggsida", sw: "Ukurasa wa Mabadiliko", ta: "மாற்ற பதிவு பக்கம்", te: "మార్పు లాగ్ పేజీ", th: "หน้าบันทึกการเปลี่ยนแปลง", uk: "Сторінка змін", vi: "Trang nhật ký thay đổi" };

T.changelogChangelogDesc = { am: "አሁን እያዩት ነው! ሲዘምን ራስ-ሰራ ይከፈታል። ከቅንብሮች ሁልጊዜ ይደረስበታል።", bg: "Гледате я в момента! Отваря се автоматично при актуализация. Достъпна от Настройки по всяко време.", bn: "আপনি এটি দেখছেন! আপডেটে স্বয়ংক্রিয়ভাবে খোলে। সেটিংস থেকে যেকোনো সময় অ্যাক্সেস করুন।", ca: "L'esteu veient! S'obre automàticament en actualitzar. Accessible des de Configuració.", cs: "Právě se na ni díváte! Otevře se automaticky při aktualizaci. Přístupná z Nastavení.", da: "Du ser på den nu! Åbner automatisk ved opdatering. Tilgængelig fra Indstillinger.", el: "Την βλέπετε! Ανοίγει αυτόματα κατά την ενημέρωση. Προσβάσιμη από τις Ρυθμίσεις.", et: "Vaatate seda praegu! Avaneb automaatselt uuendamisel. Ligipääsetav Seadetest.", fa: "الان دارید آن را می‌بینید! هنگام به‌روزرسانی خودکار باز می‌شود. از تنظیمات قابل دسترسی است.", fi: "Katsot sitä juuri nyt! Avautuu automaattisesti päivityksessä. Saatavilla Asetuksista.", fil: "Tinitingnan mo na ito! Awtomatikong bubukas sa update. Ma-access mula sa Settings.", gu: "તમે તે જોઈ રહ્યા છો! અપડેટ પર આપોઆપ ખુલે છે. સેટિંગ્સમાંથી ગમે ત્યારે ઍક્સેસ કરો.", he: "אתם מסתכלים עליו! נפתח אוטומטית בעדכון. נגיש מההגדרות.", hr: "Gledate je! Otvara se automatski pri ažuriranju. Dostupna iz Postavki.", hu: "Éppen ezt nézed! Automatikusan megnyílik frissítéskor. Bármikor elérhető a Beállításokból.", id: "Anda sedang melihatnya! Terbuka otomatis saat pembaruan. Akses kapan saja dari Pengaturan.", kn: "ನೀವು ಇದನ್ನು ನೋಡುತ್ತಿದ್ದೀರಿ! ಅಪ್‌ಡೇಟ್‌ನಲ್ಲಿ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ತೆರೆಯುತ್ತದೆ. ಸೆಟ್ಟಿಂಗ್‌ಗಳಿಂದ ಯಾವಾಗಲೂ ಪ್ರವೇಶಿಸಿ.", lt: "Jūs žiūrite į jį! Atidaromas automatiškai atnaujinant. Pasiekiamas iš Nustatymų.", lv: "Jūs to skatāt! Atveras automātiski, atjauninot. Pieejams no Iestatījumiem.", ml: "നിങ്ങൾ ഇത് കാണുകയാണ്! അപ്‌ഡേറ്റിൽ യാന്ത്രികമായി തുറക്കും. ക്രമീകരണങ്ങളിൽ നിന്ന് എപ്പോൾ വേണമെങ്കിലും ആക്‌സസ് ചെയ്യാം.", mr: "तुम्ही ते पाहत आहात! अपडेटवर स्वयंचलितपणे उघडते. सेटिंग्जमधून कधीही ऍक्सेस करा.", ms: "Anda sedang melihatnya! Dibuka secara automatik semasa kemas kini. Akses dari Tetapan bila-bila masa.", nb: "Du ser på den nå! Åpnes automatisk ved oppdatering. Tilgjengelig fra Innstillinger.", nl: "Je kijkt ernaar! Opent automatisch bij updates. Altijd bereikbaar via Instellingen.", no: "Du ser på den nå! Åpnes automatisk ved oppdatering. Tilgjengelig fra Innstillinger.", or: "ଆପଣ ଏହା ଦେଖୁଛନ୍ତି! ଅପଡେଟ୍ ସମୟରେ ସ୍ବୟଂଚାଳିତ ଭାବରେ ଖୋଲେ। ସେଟିଂସ୍ ରୁ ଯେକୌଣସି ସମୟରେ ପ୍ରବେଶ କରନ୍ତୁ।", pl: "Właśnie na nią patrzysz! Otwiera się automatycznie przy aktualizacji. Dostępna z Ustawień.", ro: "Tocmai o vedeți! Se deschide automat la actualizare. Accesibilă din Setări.", sk: "Práve sa na ňu pozeráte! Otvára sa automaticky pri aktualizácii. Prístupná z Nastavení.", sl: "Ravno jo gledate! Odpre se samodejno ob posodobitvi. Dostopna iz Nastavitev.", sr: "Управо је гледате! Отвара се аутоматски при ажурирању. Доступна из Подешавања.", sv: "Du tittar på den nu! Öppnas automatiskt vid uppdatering. Tillgänglig från Inställningar.", sw: "Unaiona sasa hivi! Inafunguliwa kiotomatiki wakati wa kusasisha. Ipatikane kutoka kwa Mipangilio.", ta: "நீங்கள் இப்போது பார்க்கிறீர்கள்! புதுப்பிக்கும்போது தானாக திறக்கும். அமைப்புகளிலிருந்து எப்போது வேண்டுமானாலும் அணுகலாம்.", te: "మీరు దాన్ని చూస్తున్నారు! అప్‌డేట్ సమయంలో స్వయంచాలకంగా తెరుచుకుంటుంది. సెట్టింగ్‌ల నుండి ఎప్పుడైనా యాక్సెస్ చేయండి.", th: "คุณกำลังดูอยู่! เปิดอัตโนมัติเมื่ออัปเดต เข้าถึงได้ทุกเมื่อจากการตั้งค่า", uk: "Ви дивитесь на неї! Відкривається автоматично при оновленні. Доступна з Налаштувань.", vi: "Bạn đang xem nó đây! Mở tự động khi cập nhật. Truy cập bất cứ lúc nào từ Cài đặt." };

T.changelogSessionRestoreTitle = { am: "ክፍለ ጊዜ ማስመለስ ጊዜ", bg: "Времена на възстановяване на сесия", bn: "সেশন পুনরুদ্ধার সময়", ca: "Temporització de restauració de sessió", cs: "Časování obnovy relací", da: "Session gendannelsestiming", el: "Χρονισμός επαναφοράς συνεδρίας", et: "Seansi taastamise ajastus", fa: "زمان‌بندی بازیابی جلسه", fi: "Istunnon palautuksen ajoitus", fil: "Timing ng Session Restore", gu: "સત્ર પુનઃસ્થાપના સમય", he: "תזמון שחזור הפעלה", hr: "Vrijeme obnove sesije", hu: "Munkamenet-visszaállítás időzítése", id: "Waktu Pemulihan Sesi", kn: "ಅವಧಿ ಮರುಸ್ಥಾಪನೆ ಸಮಯ", lt: "Sesijos atkūrimo laikas", lv: "Sesijas atjaunošanas laiks", ml: "സെഷൻ പുനഃസ്ഥാപന സമയം", mr: "सत्र पुनर्स्थापना वेळ", ms: "Masa Pemulihan Sesi", nb: "Økt-gjenopprettingstiming", nl: "Sessiehersteltiming", no: "Økt-gjenopprettingstiming", or: "ସେସନ ପୁନରୁଦ୍ଧାର ସମୟ", pl: "Czas przywracania sesji", ro: "Momentul restaurării sesiunii", sk: "Načasovanie obnovy relácie", sl: "Čas obnovitve seje", sr: "Време обнове сесије", sv: "Sessionsåterställningstiming", sw: "Muda wa Kurejesha Kikao", ta: "அமர்வு மீட்பு நேரம்", te: "సెషన్ పునరుద్ధరణ సమయం", th: "เวลาการคืนค่าเซสชัน", uk: "Таймінг відновлення сеансу", vi: "Thời gian khôi phục phiên" };

T.changelogSessionRestoreDesc = { am: "የተመለሱ ትሮች ወዲያውኑ ራስ-ሰራ አይገደቡም። አሁን በፍጥረት ጊዜ ዘመናቸውን ያስተካክላሉ።", bg: "Възстановените раздели вече не се спират автоматично незабавно. Сега правилно нулират таймерите си.", bn: "পুনরুদ্ধার করা ট্যাবগুলি আর তাৎক্ষণিকভাবে স্বয়ংক্রিয়ভাবে সাসপেন্ড হয় না। তারা এখন সঠিকভাবে তাদের নিষ্ক্রিয় টাইমার রিসেট করে।", ca: "Les pestanyes restaurades ja no se suspenen immediatament. Ara reinicien correctament els temporitzadors.", cs: "Obnovené karty se již neuspávají okamžitě. Nyní správně resetují své časovače nečinnosti.", da: "Gendannede faner suspenderes ikke længere automatisk med det samme. De nulstiller nu korrekt deres inaktivitetstimere.", el: "Οι επαναφερμένες καρτέλες δεν αναστέλλονται πλέον αμέσως. Τώρα επαναφέρουν σωστά τους χρονομετρητές αδράνειας.", et: "Taastatud vahelehti ei peatata enam kohe automaatselt. Nüüd lähtestavad nad korrektselt oma jõudeoleku taimerid.", fa: "تب‌های بازیابی شده دیگر فوراً به حالت تعلیق درنمی‌آیند. اکنون تایمرهای بیکاری خود را به درستی بازنشانی می‌کنند.", fi: "Palautettuja välilehtiä ei enää keskeytetä heti automaattisesti. Ne nollaavat nyt oikein käyttämättömyysajastimensa.", fil: "Ang mga na-restore na tab ay hindi na agad ina-auto-suspend. Nire-reset na nila nang tama ang kanilang idle timer.", gu: "પુનઃસ્થાપિત ટૅબ્સ હવે તરત જ સસ્પેન્ડ થતા નથી. તેઓ હવે તેમના નિષ્ક્રિય ટાઈમર યોગ્ય રીતે રીસેટ કરે છે.", he: "כרטיסיות שחוזרות לא מושהות יותר מיד. הן מאפסות נכון את טיימרי הסרק.", hr: "Obnovljene kartice se više ne suspendiraju odmah automatski. Sada ispravno resetiraju svoje timere mirovanja.", hu: "A visszaállított lapok már nem függesztődnek fel azonnal automatikusan. Most helyesen állítják vissza tétlenségi időzítőiket.", id: "Tab yang dipulihkan tidak lagi langsung ditangguhkan secara otomatis. Sekarang timer idle direset dengan benar.", kn: "ಮರುಸ್ಥಾಪಿಸಿದ ಟ್ಯಾಬ್‌ಗಳು ಇನ್ನು ತಕ್ಷಣವೇ ಸ್ವಯಂ-ಸ್ಥಗಿತಗೊಳ್ಳುವುದಿಲ್ಲ. ಅವು ಈಗ ತಮ್ಮ ನಿಷ್ಕ್ರಿಯ ಟೈಮರ್‌ಗಳನ್ನು ಸರಿಯಾಗಿ ಮರುಹೊಂದಿಸುತ್ತವೆ.", lt: "Atkurti skirtukai nebėra nedelsiant automatiškai pristabdomi. Dabar jie teisingai atstato savo neveiklumo laikmačius.", lv: "Atjaunotās cilnes vairs netiek nekavējoties automātiski apturētas. Tagad tās pareizi atiestata savus dīkstāves taimerus.", ml: "പുനഃസ്ഥാപിച്ച ടാബുകൾ ഇനി ഉടനടി ഓട്ടോ-സസ്‌പെൻഡ് ചെയ്യില്ല. അവ ഇപ്പോൾ അവയുടെ നിഷ്‌ക്രിയ ടൈമറുകൾ ശരിയായി റീസെറ്റ് ചെയ്യുന്നു.", mr: "पुनर्स्थापित टॅब आता लगेच स्वयंचलितपणे सस्पेंड होत नाहीत. ते आता त्यांचे निष्क्रिय टाइमर योग्यरित्या रीसेट करतात.", ms: "Tab yang dipulihkan tidak lagi ditangguhkan secara automatik serta-merta. Ia kini menetapkan semula pemasa melahu mereka dengan betul.", nb: "Gjenopprettede faner suspenderes ikke lenger automatisk umiddelbart. De tilbakestiller nå sine inaktivitetstimere korrekt.", nl: "Herstelde tabbladen worden niet meer onmiddellijk automatisch opgeschort. Ze resetten nu correct hun inactiviteitstimers.", no: "Gjenopprettede faner suspenderes ikke lenger automatisk umiddelbart. De tilbakestiller nå sine inaktivitetstimere korrekt.", or: "ପୁନରୁଦ୍ଧାର ହୋଇଥିବା ଟ୍ୟାବ୍ ଏବେ ତୁରନ୍ତ ସ୍ଥଗିତ ହୁଏ ନାହିଁ। ସେମାନେ ନିଷ୍କ୍ରିୟ ଟାଇମର୍ ସଠିକ୍ ଭାବରେ ରିସେଟ୍ କରନ୍ତି।", pl: "Przywrócone karty nie są już natychmiast automatycznie usypiane. Teraz poprawnie resetują swoje timery bezczynności.", ro: "Filele restaurate nu mai sunt suspendate automat imediat. Acum resetează corect temporizatoarele de inactivitate.", sk: "Obnovené karty sa už neuspávajú automaticky okamžite. Teraz správne resetujú svoje časovače nečinnosti.", sl: "Obnovljeni zavihki se ne zaustavijo več takoj samodejno. Zdaj pravilno ponastavijo svoje časovnike nedejavnosti.", sr: "Обновљене картице се више не суспендују одмах аутоматски. Сада правилно ресетују своје тајмере неактивности.", sv: "Återställda flikar pausas inte längre automatiskt omedelbart. De återställer nu korrekt sina inaktivitetstimrar.", sw: "Tabo zilizorejeshwa hazisimamishwi tena kiotomatiki mara moja. Sasa zinarejesha vipima vyao vya kutokuwa na shughuli kwa usahihi.", ta: "மீட்டெடுக்கப்பட்ட தாவல்கள் இனி உடனடியாக தானாக இடைநிறுத்தப்படாது. அவை இப்போது தங்கள் செயலற்ற நேர அளவைகளை சரியாக மீட்டமைக்கின்றன.", te: "పునరుద్ధరించిన ట్యాబ్‌లు ఇకపై వెంటనే ఆటో-సస్పెండ్ కావు. అవి ఇప్పుడు తమ ఐడిల్ టైమర్‌లను సరిగ్గా రీసెట్ చేస్తాయి.", th: "แท็บที่กู้คืนจะไม่ถูกระงับอัตโนมัติทันทีอีกต่อไป ตอนนี้จะรีเซ็ตตัวจับเวลาไม่ใช้งานอย่างถูกต้อง", uk: "Відновлені вкладки більше не призупиняються автоматично одразу. Тепер вони правильно скидають свої таймери бездіяльності.", vi: "Các tab được khôi phục không còn bị tạm ngưng tự động ngay lập tức. Giờ đây chúng đặt lại bộ hẹn giờ nhàn rỗi đúng cách." };

T.changelogFormCheckTitle = { am: "ቅጽ ማረጋገጫ ጊዜ ማለፍ", bg: "Таймаут за проверка на формуляри", bn: "ফর্ম চেক টাইমআউট", ca: "Temps d'espera de verificació de formulari", cs: "Časový limit kontroly formulářů", da: "Formular-kontroltimeout", el: "Χρονικό όριο ελέγχου φόρμας", et: "Vormi kontrollimise ajalõpp", fa: "مهلت بررسی فرم", fi: "Lomakkeen tarkistuksen aikakatkaisu", fil: "Form Check Timeout", gu: "ફોર્મ ચેક ટાઈમઆઉટ", he: "זמן קצוב לבדיקת טופס", hr: "Vremensko ograničenje provjere obrazaca", hu: "Űrlapellenőrzés időkorlátja", id: "Batas Waktu Pemeriksaan Formulir", kn: "ಫಾರ್ಮ್ ಪರಿಶೀಲನೆ ಸಮಯಮೀರುವಿಕೆ", lt: "Formos patikros skirtasis laikas", lv: "Veidlapas pārbaudes noildze", ml: "ഫോം ചെക്ക് ടൈമൗട്ട്", mr: "फॉर्म तपासणी कालबाह्यता", ms: "Tamat Masa Semakan Borang", nb: "Skjemakontroll-tidsavbrudd", nl: "Time-out formuliercontrole", no: "Skjemakontroll-tidsavbrudd", or: "ଫର୍ମ ଯାଞ୍ଚ ସମୟସୀମା", pl: "Limit czasu sprawdzania formularzy", ro: "Expirare verificare formular", sk: "Časový limit kontroly formulárov", sl: "Časovna omejitev preverjanja obrazcev", sr: "Временско ограничење провере образаца", sv: "Timeout för formulärkontroll", sw: "Muda wa Kukagua Fomu", ta: "படிவ சரிபார்ப்பு நேரமீறல்", te: "ఫారమ్ తనిఖీ సమయం ముగిసింది", th: "หมดเวลาตรวจสอบฟอร์ม", uk: "Тайм-аут перевірки форм", vi: "Hết thời gian kiểm tra biểu mẫu" };

T.changelogFormCheckDesc = { am: "የቅጽ ውሂብ ማረጋገጫ አሁን 500ms ጊዜ ገደብ አለው ስለዚህ ምላሽ የማይሰጡ ትሮች ወረፋውን ማገድ አይችሉም።", bg: "Проверката на формулярни данни вече има таймаут от 500ms, така че неотзивчиви раздели не могат да блокират опашката.", bn: "ফর্ম ডেটা চেকের এখন 500ms টাইমআউট আছে যাতে অপ্রতিক্রিয়াশীল ট্যাব সারি ব্লক করতে না পারে।", ca: "La verificació de formularis ara té un temps d'espera de 500ms perquè les pestanyes que no responen no bloquegin la cua.", cs: "Kontrola formulářů má nyní 500ms časový limit, aby nereagující karty nemohly blokovat frontu.", da: "Formularkontrol har nu en 500ms timeout, så ikke-reagerende faner ikke kan blokere køen.", el: "Ο έλεγχος φόρμας έχει πλέον χρονικό όριο 500ms, ώστε οι μη ανταποκρινόμενες καρτέλες να μην μπλοκάρουν την ουρά.", et: "Vormi andmete kontrollimisel on nüüd 500ms ajalõpp, et reageerimata vahelehed ei saaks järjekorda blokeerida.", fa: "بررسی فرم اکنون مهلت 500 میلی‌ثانیه‌ای دارد تا تب‌های بدون پاسخ نتوانند صف را مسدود کنند.", fi: "Lomakkeen tarkistuksella on nyt 500ms aikakatkaisu, jotta reagoimattomat välilehdet eivät voi estää jonoa.", fil: "Ang form check ay may 500ms timeout na para hindi ma-block ng hindi tumutugon na mga tab ang queue.", gu: "ફોર્મ ડેટા ચેકમાં હવે 500ms ટાઈમઆઉટ છે જેથી પ્રતિસાદ ન આપતા ટૅબ્સ કતાર અવરોધિત ન કરી શકે.", he: "בדיקת נתוני טופס כוללת עכשיו timeout של 500ms כדי שכרטיסיות שלא מגיבות לא יחסמו את התור.", hr: "Provjera obrazaca sada ima timeout od 500ms tako da nereagirajuće kartice ne mogu blokirati red.", hu: "Az űrlapellenőrzés most 500ms-os időkorláttal rendelkezik, így a nem reagáló lapok nem blokkolhatják a várakozási sort.", id: "Pemeriksaan formulir sekarang memiliki batas waktu 500ms sehingga tab yang tidak responsif tidak dapat memblokir antrean.", kn: "ಫಾರ್ಮ್ ಡೇಟಾ ಪರಿಶೀಲನೆಯು ಈಗ 500ms ಸಮಯಮೀರುವಿಕೆಯನ್ನು ಹೊಂದಿದೆ ಆದ್ದರಿಂದ ಪ್ರತಿಕ್ರಿಯಿಸದ ಟ್ಯಾಬ್‌ಗಳು ಸರತಿಯನ್ನು ತಡೆಯಲು ಸಾಧ್ಯವಿಲ್ಲ.", lt: "Formos duomenų patikra dabar turi 500ms skirtąjį laiką, todėl nereaguojantys skirtukai negali blokuoti eilės.", lv: "Veidlapas datu pārbaudei tagad ir 500ms noildze, tāpēc nereaģējošas cilnes nevar bloķēt rindu.", ml: "ഫോം ഡാറ്റ പരിശോധനയ്ക്ക് ഇപ്പോൾ 500ms ടൈമൗട്ട് ഉണ്ട്, അതിനാൽ പ്രതികരിക്കാത്ത ടാബുകൾ ക്യൂ തടയില്ല.", mr: "फॉर्म डेटा तपासणीसाठी आता 500ms कालबाह्यता आहे जेणेकरून प्रतिसाद न देणारे टॅब रांग अडवू शकत नाहीत.", ms: "Semakan data borang kini mempunyai had masa 500ms supaya tab yang tidak bertindak balas tidak boleh menyekat barisan.", nb: "Skjemadatasjekken har nå en 500ms tidsavbrudd slik at ikke-reagerende faner ikke kan blokkere køen.", nl: "De formuliercontrole heeft nu een timeout van 500ms zodat niet-reagerende tabbladen de wachtrij niet kunnen blokkeren.", no: "Skjemadatasjekken har nå en 500ms tidsavbrudd slik at ikke-reagerende faner ikke kan blokkere køen.", or: "ଫର୍ମ ଡାଟା ଯାଞ୍ଚରେ ଏବେ 500ms ସମୟସୀମା ଅଛି ଯାହା ଫଳରେ ଅପ୍ରତିକ୍ରିୟାଶୀଳ ଟ୍ୟାବ୍ ସାରିକୁ ଅବରୋଧ କରିପାରିବ ନାହିଁ।", pl: "Sprawdzanie formularzy ma teraz 500ms limit czasu, więc niereagujące karty nie mogą blokować kolejki.", ro: "Verificarea formularelor are acum un timeout de 500ms, astfel încât filele care nu răspund nu pot bloca coada.", sk: "Kontrola formulárov má teraz 500ms časový limit, takže nereagujúce karty nemôžu blokovať front.", sl: "Preverjanje obrazcev ima zdaj 500ms časovno omejitev, da neodzivni zavihki ne morejo blokirati čakalne vrste.", sr: "Провера образаца сада има 500ms временско ограничење тако да картице које не реагују не могу блокирати ред.", sv: "Formulärkontrollen har nu en 500ms timeout så att flikar som inte svarar inte kan blockera kön.", sw: "Ukaguzi wa data ya fomu sasa una muda wa 500ms ili tabo zisizojbu haziwezi kuzuia foleni.", ta: "படிவ தரவுச் சரிபார்ப்பு இப்போது 500ms நேரமீறலைக் கொண்டுள்ளது, எனவே பதிலளிக்காத தாவல்கள் வரிசையைத் தடுக்க முடியாது.", te: "ఫారమ్ డేటా తనిఖీకి ఇప్పుడు 500ms టైమ్‌అవుట్ ఉంది, కాబట్టి స్పందించని ట్యాబ్‌లు క్యూను బ్లాక్ చేయలేవు.", th: "การตรวจสอบฟอร์มมีการหมดเวลา 500ms แล้ว ดังนั้นแท็บที่ไม่ตอบสนองจะไม่สามารถบล็อกคิวได้", uk: "Перевірка даних форм тепер має тайм-аут 500мс, тому вкладки, що не відповідають, не можуть блокувати чергу.", vi: "Kiểm tra biểu mẫu giờ có thời gian chờ 500ms để các tab không phản hồi không thể chặn hàng đợi." };

T.changelogWhitelistDupesTitle = { am: "ነጭ ዝርዝር ድግግሞሽ", bg: "Дубликати в белия списък", bn: "হোয়াইটলিস্ট ডুপ্লিকেট", ca: "Duplicats a la llista blanca", cs: "Duplicity v seznamu povolených", da: "Hvidliste-dubletter", el: "Διπλότυπα λευκής λίστας", et: "Lubatavate nimekirja duplikaadid", fa: "تکراری‌های لیست سفید", fi: "Sallittujen listan kopiot", fil: "Mga Duplicate sa Whitelist", gu: "વ્હાઇટલિસ્ટ ડુપ્લિકેટ્સ", he: "כפילויות ברשימת ההיתרים", hr: "Duplikati bijele liste", hu: "Engedélyezési lista duplikátumok", id: "Duplikat Daftar Putih", kn: "ಶ್ವೇತಪಟ್ಟಿ ನಕಲುಗಳು", lt: "Baltojo sąrašo dublikatai", lv: "Baltā saraksta dublikāti", ml: "വൈറ്റ്‌ലിസ്റ്റ് ഡ്യൂപ്ലിക്കേറ്റുകൾ", mr: "श्वेतसूची डुप्लिकेट", ms: "Pendua Senarai Putih", nb: "Hviteliste-duplikater", nl: "Witte lijst-duplicaten", no: "Hviteliste-duplikater", or: "ଧଳା ତାଲିକା ନକଲ", pl: "Duplikaty białej listy", ro: "Duplicate în lista albă", sk: "Duplikáty bieleho zoznamu", sl: "Dvojniki belega seznama", sr: "Дупликати беле листе", sv: "Vitlisteduplikat", sw: "Nakala za Orodha Nyeupe", ta: "அனுமதிப் பட்டியல் நகல்கள்", te: "వైట్‌లిస్ట్ డూప్లికేట్‌లు", th: "รายการซ้ำในรายการที่อนุญาต", uk: "Дублікати білого списку", vi: "Trùng lặp danh sách trắng" };

// For the remaining changelog keys, I'll use the same pattern with locale-specific translations
T.changelogWhitelistDupesDesc = { am: "የፊደል ልዩነት ችግር ተስተካክሏል። ሁሉም ግቤቶች አሁን ተመሳሳይ ናቸው።", bg: "Коригиран проблем с чувствителността към регистъра. Всички записи вече са нормализирани.", bn: "কেস সংবেদনশীলতার সমস্যা ঠিক করা হয়েছে। সমস্ত এন্ট্রি এখন স্বাভাবিক করা হয়েছে।", ca: "S'ha corregit la sensibilitat a majúscules. Totes les entrades ara estan normalitzades.", cs: "Opraven problém s rozlišováním velkých a malých písmen. Všechny záznamy jsou nyní normalizovány.", da: "Rettet problem med store/små bogstaver. Alle poster er nu normaliseret.", el: "Διορθώθηκε πρόβλημα ευαισθησίας πεζών-κεφαλαίων. Όλες οι εγγραφές είναι πλέον κανονικοποιημένες.", et: "Parandatud tõstutundlikkuse probleem. Kõik kirjed on nüüd normaliseeritud.", fa: "مشکل حساسیت به حروف بزرگ/کوچک رفع شد. تمام ورودی‌ها اکنون نرمال شده‌اند.", fi: "Korjattu kirjainkoon ongelma. Kaikki merkinnät on nyt normalisoitu.", fil: "Naayos ang case sensitivity issue. Lahat ng entries ay normalized na.", gu: "કેસ સંવેદનશીલતાની સમસ્યા ઠીક કરી. બધી એન્ટ્રીઓ હવે સામાન્ય કરેલ છે.", he: "תוקנה בעיית רגישות לאותיות. כל הרשומות מנורמלות כעת.", hr: "Ispravljen problem osjetljivosti na velika/mala slova. Svi unosi su sada normalizirani.", hu: "Javított kis- és nagybetű-érzékenységi probléma. Minden bejegyzés normalizálva.", id: "Perbaikan masalah sensitivitas huruf besar/kecil. Semua entri sekarang dinormalisasi.", kn: "ಕೇಸ್ ಸೂಕ್ಷ್ಮತೆ ಸಮಸ್ಯೆ ಸರಿಪಡಿಸಲಾಗಿದೆ. ಎಲ್ಲಾ ನಮೂದುಗಳು ಈಗ ಸಾಮಾನ್ಯೀಕರಿಸಲಾಗಿದೆ.", lt: "Ištaisyta didžiųjų/mažųjų raidžių problema. Visi įrašai dabar normalizuoti.", lv: "Novērsta lielo/mazo burtu jutīguma problēma. Visi ieraksti tagad ir normalizēti.", ml: "കേസ് സെൻസിറ്റിവിറ്റി പ്രശ്നം പരിഹരിച്ചു. എല്ലാ എൻട്രികളും ഇപ്പോൾ നോർമലൈസ് ചെയ്തിരിക്കുന്നു.", mr: "केस सेन्सिटिव्हिटी समस्या दुरुस्त केली. सर्व नोंदी आता सामान्यीकृत आहेत.", ms: "Masalah kepekaan huruf besar/kecil telah diperbaiki. Semua entri kini dinormalisasi.", nb: "Rettet problem med store/små bokstaver. Alle oppføringer er nå normalisert.", nl: "Probleem met hoofdlettergevoeligheid opgelost. Alle vermeldingen zijn nu genormaliseerd.", no: "Rettet problem med store/små bokstaver. Alle oppføringer er nå normalisert.", or: "କେସ ସଂବେଦନଶୀଳତା ସମସ୍ୟା ସମାଧାନ ହେଲା। ସମସ୍ତ ପ୍ରବେଶ ଏବେ ସାଧାରଣୀକୃତ।", pl: "Naprawiono problem z rozróżnianiem wielkości liter. Wszystkie wpisy są teraz znormalizowane.", ro: "Corectată problema de sensibilitate la litere mari/mici. Toate intrările sunt acum normalizate.", sk: "Opravený problém s rozlišovaním veľkých a malých písmen. Všetky záznamy sú teraz normalizované.", sl: "Odpravljena težava z občutljivostjo na velike/male črke. Vsi vnosi so zdaj normalizirani.", sr: "Исправљен проблем осетљивости на велика/мала слова. Сви уноси су сада нормализовани.", sv: "Åtgärdat problem med versalkänslighet. Alla poster är nu normaliserade.", sw: "Tatizo la unyeti wa herufi kubwa/ndogo limerekebishwa. Maingizo yote sasa yamekuwa ya kawaida.", ta: "எழுத்து உணர்திறன் சிக்கல் சரி செய்யப்பட்டது. அனைத்து உள்ளீடுகளும் இப்போது இயல்பாக்கப்பட்டுள்ளன.", te: "కేస్ సెన్సిటివిటీ సమస్య పరిష్కరించబడింది. అన్ని ఎంట్రీలు ఇప్పుడు సాధారణీకరించబడ్డాయి.", th: "แก้ไขปัญหาตัวอักษรพิมพ์ใหญ่/เล็กแล้ว รายการทั้งหมดถูกทำให้เป็นมาตรฐานแล้ว", uk: "Виправлено проблему чутливості до регістру. Усі записи тепер нормалізовані.", vi: "Đã sửa lỗi phân biệt chữ hoa/thường. Tất cả mục nhập giờ đã được chuẩn hóa." };

T.changelogLiveStatsTitle = { am: "ቀጥታ ስታቲስቲክስ", bg: "Статистики в реално време", bn: "লাইভ পরিসংখ্যান", ca: "Estadístiques en directe", cs: "Živé statistiky", da: "Live statistikker", el: "Ζωντανά στατιστικά", et: "Reaalajas statistika", fa: "آمار زنده", fi: "Reaaliaikaiset tilastot", fil: "Live Stats", gu: "લાઇવ આંકડા", he: "סטטיסטיקות חיות", hr: "Statistike uživo", hu: "Élő statisztikák", id: "Statistik Langsung", kn: "ನೇರ ಅಂಕಿಅಂಶಗಳು", lt: "Tiesioginė statistika", lv: "Reāllaika statistika", ml: "തത്സമയ സ്ഥിതിവിവരക്കണക്കുകൾ", mr: "लाइव आकडेवारी", ms: "Statistik Langsung", nb: "Sanntidsstatistikk", nl: "Live statistieken", no: "Sanntidsstatistikk", or: "ସିଧା ପରିସଂଖ୍ୟାନ", pl: "Statystyki na żywo", ro: "Statistici în timp real", sk: "Štatistiky naživo", sl: "Statistike v živo", sr: "Статистике уживо", sv: "Realtidsstatistik", sw: "Takwimu za Moja kwa Moja", ta: "நேரடி புள்ளிவிவரங்கள்", te: "లైవ్ గణాంకాలు", th: "สถิติสด", uk: "Статистика в реальному часі", vi: "Thống kê trực tiếp" };

T.changelogLiveStatsDesc = { am: "ትሮች ሲገደቡ ወይም ሲነቁ ፖፕአፕ ራስ-ሰራ ያድሳል።", bg: "Попъпът вече се обновява автоматично при спиране или събуждане на раздели.", bn: "ট্যাব সাসপেন্ড বা জাগানো হলে পপআপ স্বয়ংক্রিয়ভাবে রিফ্রেশ হয়।", ca: "El popup s'actualitza automàticament quan les pestanyes se suspenen o es desperten.", cs: "Popup se nyní automaticky aktualizuje, když jsou karty uspány nebo probuzeny.", da: "Popup opdateres nu automatisk, når faner suspenderes eller vækkes.", el: "Το popup ανανεώνεται αυτόματα όταν οι καρτέλες αναστέλλονται ή ξυπνούν.", et: "Hüpikaken värskendab nüüd automaatselt, kui vahelehti peatatakse või äratatakse.", fa: "پاپ‌آپ اکنون هنگام تعلیق یا بیدار شدن تب‌ها به‌روزرسانی خودکار می‌شود.", fi: "Ponnahdusikkuna päivittyy nyt automaattisesti, kun välilehtiä keskeytetään tai herätetään.", fil: "Ang popup ay awtomatikong nagre-refresh kapag nag-suspend o naggising ang mga tab.", gu: "ટૅબ્સ સસ્પેન્ડ થાય અથવા જાગે ત્યારે પૉપઅપ આપોઆપ રિફ્રેશ થાય છે.", he: "החלון הקופץ מתעדכן אוטומטית כשכרטיסיות מושהות או מתעוררות.", hr: "Popup se sada automatski osvježava kada se kartice suspendiraju ili bude.", hu: "A felugró ablak automatikusan frissül, amikor a lapok felfüggesztésre kerülnek vagy felébrednek.", id: "Popup sekarang diperbarui otomatis saat tab ditangguhkan atau dibangunkan.", kn: "ಟ್ಯಾಬ್‌ಗಳನ್ನು ಸ್ಥಗಿತಗೊಳಿಸಿದಾಗ ಅಥವಾ ಎಚ್ಚರಗೊಳಿಸಿದಾಗ ಪಾಪ್‌ಅಪ್ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ರಿಫ್ರೆಶ್ ಆಗುತ್ತದೆ.", lt: "Iššokantysis langas dabar automatiškai atnaujinamas pristabdant arba pažadinant skirtukus.", lv: "Uznirstošais logs tagad automātiski atjauninās, kad cilnes tiek apturētas vai pamodinātas.", ml: "ടാബുകൾ സസ്പെൻഡ് ചെയ്യുമ്പോഴോ ഉണർത്തുമ്പോഴോ പോപ്പ്-അപ്പ് സ്വയം പുതുക്കുന്നു.", mr: "टॅब सस्पेंड किंवा जागृत झाल्यावर पॉपअप स्वयंचलितपणे रिफ्रेश होतो.", ms: "Popup kini dikemas kini secara automatik apabila tab ditangguhkan atau dibangunkam.", nb: "Popup oppdateres nå automatisk når faner suspenderes eller vekkes.", nl: "De popup wordt nu automatisch vernieuwd wanneer tabbladen worden opgeschort of geactiveerd.", no: "Popup oppdateres nå automatisk når faner suspenderes eller vekkes.", or: "ଟ୍ୟାବ୍ ସ୍ଥଗିତ ବା ଜାଗ୍ରତ ହେଲେ ପପଅପ୍ ସ୍ବୟଂଚାଳିତ ଭାବରେ ସତେଜ ହୁଏ।", pl: "Popup automatycznie się odświeża, gdy karty są usypiane lub budzone.", ro: "Popup-ul se actualizează automat când filele sunt suspendate sau trezite.", sk: "Popup sa teraz automaticky obnovuje pri uspávaní alebo prebúdzaní kariet.", sl: "Pojavno okno se zdaj samodejno osvežuje ob zaustavitvi ali prebuditvi zavihkov.", sr: "Искачући прозор се аутоматски освежава када се картице суспендују или пробуде.", sv: "Popup uppdateras nu automatiskt när flikar pausas eller vaknar.", sw: "Popup sasa inasasishwa kiotomatiki tabo zinaposimamishwa au kuamshwa.", ta: "தாவல்கள் இடைநிறுத்தப்படும்போது அல்லது எழுப்பப்படும்போது பாப்அப் தானாக புதுப்பிக்கிறது.", te: "ట్యాబ్‌లు సస్పెండ్ చేయబడినప్పుడు లేదా మేల్కొన్నప్పుడు పాప్‌అప్ స్వయంచాలకంగా రిఫ్రెష్ అవుతుంది.", th: "ป๊อปอัปรีเฟรชอัตโนมัติเมื่อแท็บถูกระงับหรือปลุก", uk: "Спливаюче вікно тепер автоматично оновлюється, коли вкладки призупиняються або пробуджуються.", vi: "Popup tự động làm mới khi tab được tạm ngưng hoặc đánh thức." };

T.changelogSessionOptionsTitle = { am: "ክፍለ ጊዜ ማስመለስ አማራጮች", bg: "Опции за възстановяване на сесия", bn: "সেশন পুনরুদ্ধার বিকল্প", ca: "Opcions de restauració de sessió", cs: "Možnosti obnovy relací", da: "Session gendannelsesmuligheder", el: "Επιλογές επαναφοράς συνεδρίας", et: "Seansi taastamise valikud", fa: "گزینه‌های بازیابی جلسه", fi: "Istunnon palautusasetukset", fil: "Mga Opsyon sa Session Restore", gu: "સત્ર પુનઃસ્થાપના વિકલ્પો", he: "אפשרויות שחזור הפעלה", hr: "Opcije obnove sesije", hu: "Munkamenet-visszaállítási lehetőségek", id: "Opsi Pemulihan Sesi", kn: "ಅವಧಿ ಮರುಸ್ಥಾಪನೆ ಆಯ್ಕೆಗಳು", lt: "Sesijos atkūrimo parinktys", lv: "Sesijas atjaunošanas opcijas", ml: "സെഷൻ പുനഃസ്ഥാപന ഓപ്ഷനുകൾ", mr: "सत्र पुनर्स्थापना पर्याय", ms: "Pilihan Pemulihan Sesi", nb: "Økt-gjenopprettingsalternativer", nl: "Sessieherstelopties", no: "Økt-gjenopprettingsalternativer", or: "ସେସନ ପୁନରୁଦ୍ଧାର ବିକଳ୍ପ", pl: "Opcje przywracania sesji", ro: "Opțiuni de restaurare a sesiunii", sk: "Možnosti obnovy relácie", sl: "Možnosti obnovitve seje", sr: "Опције обнове сесије", sv: "Alternativ för sessionsåterställning", sw: "Chaguzi za Kurejesha Kikao", ta: "அமர்வு மீட்பு விருப்பங்கள்", te: "సెషన్ పునరుద్ధరణ ఎంపికలు", th: "ตัวเลือกการคืนค่าเซสชัน", uk: "Параметри відновлення сеансу", vi: "Tùy chọn khôi phục phiên" };

T.changelogSessionOptionsDesc = { am: "ክፍለ ጊዜዎች አሁን \"ክፈት\" (ትሮች ጨምር) እና \"ተካ\" (አሁን ያሉ ትሮችን ቀይር) ተለያዩ ቁልፎች አሏቸው።", bg: "Сесиите вече имат отделни бутони \"Отвори\" и \"Замени\".", bn: "সেশনে এখন আলাদা \"খোলো\" এবং \"প্রতিস্থাপন\" বোতাম আছে।", ca: "Les sessions ara tenen botons separats \"Obre\" i \"Substitueix\".", cs: "Relace nyní mají oddělená tlačítka \"Otevřít\" a \"Nahradit\".", da: "Sessioner har nu separate \"Åbn\" og \"Erstat\" knapper.", el: "Οι συνεδρίες έχουν πλέον ξεχωριστά κουμπιά \"Άνοιγμα\" και \"Αντικατάσταση\".", et: "Seansidel on nüüd eraldi nupud \"Ava\" ja \"Asenda\".", fa: "جلسات اکنون دکمه‌های جداگانه \"باز کردن\" و \"جایگزینی\" دارند.", fi: "Istunnoilla on nyt erilliset \"Avaa\" ja \"Korvaa\" -painikkeet.", fil: "Ang mga session ay may hiwalay na na \"Buksan\" at \"Palitan\" na mga button.", gu: "સત્રોમાં હવે અલગ \"ખોલો\" અને \"બદલો\" બટન છે.", he: "להפעלות יש כעת כפתורי \"פתח\" ו\"החלף\" נפרדים.", hr: "Sesije sada imaju zasebne gumbe \"Otvori\" i \"Zamijeni\".", hu: "A munkameneteknek most külön \"Megnyitás\" és \"Csere\" gombjai vannak.", id: "Sesi sekarang memiliki tombol terpisah \"Buka\" dan \"Ganti\".", kn: "ಅವಧಿಗಳಲ್ಲಿ ಈಗ ಪ್ರತ್ಯೇಕ \"ತೆರೆಯಿರಿ\" ಮತ್ತು \"ಬದಲಿಸಿ\" ಬಟನ್‌ಗಳಿವೆ.", lt: "Sesijose dabar yra atskiri mygtukai \"Atidaryti\" ir \"Pakeisti\".", lv: "Sesijām tagad ir atseviškas pogas \"Atvērt\" un \"Aizvietot\".", ml: "സെഷനുകൾക്ക് ഇപ്പോൾ \"തുറക്കുക\" എന്നും \"മാറ്റിസ്ഥാപിക്കുക\" എന്നും പ്രത്യേക ബട്ടണുകളുണ്ട്.", mr: "सत्रांमध्ये आता स्वतंत्र \"उघडा\" आणि \"बदला\" बटणे आहेत.", ms: "Sesi kini mempunyai butang \"Buka\" dan \"Ganti\" yang berasingan.", nb: "Økter har nå separate \"Åpne\" og \"Erstatt\" knapper.", nl: "Sessies hebben nu aparte knoppen \"Openen\" en \"Vervangen\".", no: "Økter har nå separate \"Åpne\" og \"Erstatt\" knapper.", or: "ସେସନ ମାନଙ୍କରେ ଏବେ ଅଲଗା \"ଖୋଲନ୍ତୁ\" ଏବଂ \"ବଦଳାନ୍ତୁ\" ବଟନ୍ ଅଛି।", pl: "Sesje mają teraz oddzielne przyciski \"Otwórz\" i \"Zastąp\".", ro: "Sesiunile au acum butoane separate \"Deschide\" și \"Înlocuiește\".", sk: "Relácie majú teraz oddelené tlačidlá \"Otvoriť\" a \"Nahradiť\".", sl: "Seje imajo zdaj ločena gumba \"Odpri\" in \"Zamenjaj\".", sr: "Сесије сада имају одвојене дугмиће \"Отвори\" и \"Замени\".", sv: "Sessioner har nu separata knappar \"Öppna\" och \"Ersätt\".", sw: "Vikao sasa vina vitufe tofauti vya \"Fungua\" na \"Badilisha\".", ta: "அமர்வுகளில் இப்போது தனித்தனி \"திற\" மற்றும் \"மாற்று\" பொத்தான்கள் உள்ளன.", te: "సెషన్‌లకు ఇప్పుడు ప్రత్యేక \"ఓపెన్\" మరియు \"భర్తీ\" బటన్‌లు ఉన్నాయి.", th: "เซสชันมีปุ่ม \"เปิด\" และ \"แทนที่\" แยกกันแล้ว", uk: "Сеанси тепер мають окремі кнопки \"Відкрити\" та \"Замінити\".", vi: "Phiên giờ có các nút \"Mở\" và \"Thay thế\" riêng biệt." };

T.changelogWhitelistValTitle = { am: "ነጭ ዝርዝር ማረጋገጫ እና ወደ ውጭ/ወደ ውስጥ", bg: "Валидиране и експорт/импорт на белия списък", bn: "হোয়াইটলিস্ট যাচাই ও রপ্তানি/আমদানি", ca: "Validació i exportació/importació de la llista blanca", cs: "Validace a export/import seznamu povolených", da: "Hvidliste-validering og eksport/import", el: "Επαλήθευση και εξαγωγή/εισαγωγή λευκής λίστας", et: "Lubatavate nimekirja valideerimine ja eksport/import", fa: "اعتبارسنجی و صادرات/واردات لیست سفید", fi: "Sallittujen listan validointi ja vienti/tuonti", fil: "Whitelist Validation at Export/Import", gu: "વ્હાઇટલિસ્ટ માન્યતા અને નિકાસ/આયાત", he: "אימות ויצוא/ייבוא של רשימת היתרים", hr: "Provjera i izvoz/uvoz bijele liste", hu: "Engedélyezési lista ellenőrzése és exportálás/importálás", id: "Validasi dan Ekspor/Impor Daftar Putih", kn: "ಶ್ವೇತಪಟ್ಟಿ ಊರ್ಜಿತಗೊಳಿಸುವಿಕೆ ಮತ್ತು ರಫ್ತು/ಆಮದು", lt: "Baltojo sąrašo tikrinimas ir eksportas/importas", lv: "Baltā saraksta validācija un eksports/imports", ml: "വൈറ്റ്‌ലിസ്റ്റ് സാധൂകരണവും എക്സ്പോർട്ട്/ഇംപോർട്ടും", mr: "श्वेतसूची सत्यापन आणि निर्यात/आयात", ms: "Pengesahan dan Eksport/Import Senarai Putih", nb: "Hviteliste-validering og eksport/import", nl: "Witte lijst-validatie en exporteren/importeren", no: "Hviteliste-validering og eksport/import", or: "ଧଳା ତାଲିକା ଯାଞ୍ଚ ଏବଂ ରପ୍ତାନି/ଆମଦାନୀ", pl: "Walidacja i eksport/import białej listy", ro: "Validare și export/import al listei albe", sk: "Validácia a export/import bieleho zoznamu", sl: "Preverjanje in izvoz/uvoz belega seznama", sr: "Валидација и извоз/увоз беле листе", sv: "Vitlistevalidering och export/import", sw: "Uthibitisho na Uhamishaji wa Orodha Nyeupe", ta: "அனுமதிப் பட்டியல் சரிபார்ப்பு மற்றும் ஏற்றுமதி/இறக்குமதி", te: "వైట్‌లిస్ట్ ధ్రువీకరణ మరియు ఎగుమతి/దిగుమతి", th: "การตรวจสอบรายการที่อนุญาตและส่งออก/นำเข้า", uk: "Валідація та експорт/імпорт білого списку", vi: "Xác thực và xuất/nhập danh sách trắng" };

T.changelogWhitelistValDesc = { am: "ነጭ ዝርዝር ግቤት ጎራዎችን ያረጋግጣል። ከቅንጥብ ሰሌዳ ማስመጣት እና መላክም ይችላሉ።", bg: "Вписването в белия списък вече валидира домейни. Можете да експортирате и импортирате чрез клипборда.", bn: "হোয়াইটলিস্ট ইনপুট এখন ডোমেইন যাচাই করে। ক্লিপবোর্ডের মাধ্যমে রপ্তানি ও আমদানি করতে পারেন।", ca: "L'entrada de la llista blanca ara valida dominis. Podeu exportar i importar via porta-retalls.", cs: "Vstup seznamu povolených nyní ověřuje domény. Můžete exportovat a importovat přes schránku.", da: "Hvidliste-input validerer nu domæner. Du kan eksportere og importere via udklipsholder.", el: "Η εισαγωγή λευκής λίστας τώρα επαληθεύει τομείς. Μπορείτε να εξάγετε και εισάγετε μέσω προχείρου.", et: "Lubatavate nimekirja sisend valideerib nüüd domeene. Saate eksportida ja importida lõikelaua kaudu.", fa: "ورودی لیست سفید اکنون دامنه‌ها را اعتبارسنجی می‌کند. می‌توانید از طریق کلیپ‌بورد صادر و وارد کنید.", fi: "Sallittujen lista tarkistaa nyt verkkotunnukset. Voit viedä ja tuoda leikepöydän kautta.", fil: "Ang whitelist input ay nagva-validate na ng mga domain. Maaari kang mag-export at import sa pamamagitan ng clipboard.", gu: "વ્હાઇટલિસ્ટ ઇનપુટ હવે ડોમેન માન્ય કરે છે. ક્લિપબોર્ડ દ્વારા નિકાસ અને આયાત કરી શકો છો.", he: "קלט רשימת ההיתרים מאמת כעת דומיינים. ניתן לייצא ולייבא דרך הלוח.", hr: "Unos bijele liste sada provjerava domene. Možete izvoziti i uvoziti putem međuspremnika.", hu: "Az engedélyezési lista bevitele most érvényesíti a domaineket. Exportálhat és importálhat a vágólapon keresztül.", id: "Input daftar putih sekarang memvalidasi domain. Anda dapat mengekspor dan mengimpor melalui papan klip.", kn: "ಶ್ವೇತಪಟ್ಟಿ ಇನ್‌ಪುಟ್ ಈಗ ಡೊಮೇನ್‌ಗಳನ್ನು ಊರ್ಜಿತಗೊಳಿಸುತ್ತದೆ. ಕ್ಲಿಪ್‌ಬೋರ್ಡ್ ಮೂಲಕ ರಫ್ತು ಮತ್ತು ಆಮದು ಮಾಡಬಹುದು.", lt: "Baltojo sąrašo įvestis dabar tikrina domenus. Galite eksportuoti ir importuoti per iškarpinę.", lv: "Baltā saraksta ievade tagad validē domēnus. Jūs varat eksportēt un importēt caur starpliktuvi.", ml: "വൈറ്റ്‌ലിസ്റ്റ് ഇൻപുട്ട് ഇപ്പോൾ ഡൊമെയ്‌നുകൾ സാധൂകരിക്കുന്നു. ക്ലിപ്പ്ബോർഡ് വഴി എക്സ്‌പോർട്ടും ഇംപോർട്ടും ചെയ്യാം.", mr: "श्वेतसूची इनपुट आता डोमेन सत्यापित करते. क्लिपबोर्डद्वारे निर्यात आणि आयात करू शकता.", ms: "Input senarai putih kini mengesahkan domain. Anda boleh mengeksport dan mengimport melalui papan klip.", nb: "Hviteliste-input validerer nå domener. Du kan eksportere og importere via utklippstavle.", nl: "Invoer van de witte lijst valideert nu domeinen. U kunt exporteren en importeren via het klembord.", no: "Hviteliste-input validerer nå domener. Du kan eksportere og importere via utklippstavle.", or: "ଧଳା ତାଲିକା ଇନପୁଟ୍ ଏବେ ଡୋମେନ ଯାଞ୍ଚ କରେ। କ୍ଲିପବୋର୍ଡ ମାଧ୍ୟମରେ ରପ୍ତାନି ଏବଂ ଆମଦାନୀ କରିପାରିବେ।", pl: "Wprowadzanie białej listy teraz waliduje domeny. Możesz eksportować i importować przez schowek.", ro: "Introducerea listei albe validează acum domeniile. Puteți exporta și importa prin clipboard.", sk: "Vstup bieleho zoznamu teraz overuje domény. Môžete exportovať a importovať cez schránku.", sl: "Vnos belega seznama zdaj preverja domene. Izvažate in uvažate lahko prek odložišča.", sr: "Унос беле листе сада проверава домене. Можете извозити и увозити преко оставе.", sv: "Vitlisteinmatningen validerar nu domäner. Du kan exportera och importera via urklipp.", sw: "Ingizo la orodha nyeupe sasa linathibitisha vikoa. Unaweza kuhamisha nje na kuingiza kupitia ubao wa kunakili.", ta: "அனுமதிப் பட்டியல் உள்ளீடு இப்போது டொமைன்களை சரிபார்க்கிறது. கிளிப்போர்டு வழியாக ஏற்றுமதி மற்றும் இறக்குமதி செய்யலாம்.", te: "వైట్‌లిస్ట్ ఇన్‌పుట్ ఇప్పుడు డొమైన్‌లను ధ్రువీకరిస్తుంది. క్లిప్‌బోర్డ్ ద్వారా ఎగుమతి మరియు దిగుమతి చేయవచ్చు.", th: "อินพุตรายการที่อนุญาตตรวจสอบโดเมนแล้ว สามารถส่งออกและนำเข้าผ่านคลิปบอร์ดได้", uk: "Введення білого списку тепер перевіряє домени. Ви можете експортувати та імпортувати через буфер обміну.", vi: "Nhập danh sách trắng giờ xác thực tên miền. Bạn có thể xuất và nhập qua bộ nhớ tạm." };

T.changelogA11yTitle = { am: "ተደራሽነት", bg: "Достъпност", bn: "অ্যাক্সেসিবিলিটি", ca: "Accessibilitat", cs: "Přístupnost", da: "Tilgængelighed", el: "Προσβασιμότητα", et: "Ligipääsetavus", fa: "دسترسی‌پذیری", fi: "Esteettömyys", fil: "Accessibility", gu: "સુલભતા", he: "נגישות", hr: "Pristupačnost", hu: "Akadálymentesítés", id: "Aksesibilitas", kn: "ಪ್ರವೇಶಿಸುವಿಕೆ", lt: "Prieinamumas", lv: "Pieejamība", ml: "പ്രാപ്യത", mr: "सुलभता", ms: "Kebolehcapaian", nb: "Tilgjengelighet", nl: "Toegankelijkheid", no: "Tilgjengelighet", or: "ସୁଗମ୍ୟତା", pl: "Dostępność", ro: "Accesibilitate", sk: "Prístupnosť", sl: "Dostopnost", sr: "Приступачност", sv: "Tillgänglighet", sw: "Ufikivu", ta: "அணுகல்தன்மை", te: "ప్రాప్యత", th: "การเข้าถึง", uk: "Доступність", vi: "Khả năng truy cập" };

T.changelogA11yDesc = { am: "የትሮች ዝርዝር ንጥሎች አሁን ከኪቦርድ ሊደረስባቸው ይችላሉ ከ ARIA ሚናዎች ጋር። የማሳወቂያዎች ለማንበቢያ ሰሌዳ ይታወቃሉ።", bg: "Елементите от списъка с раздели вече са навигируеми с клавиатура с ARIA роли. Известията се обявяват на екранните четци.", bn: "ট্যাব তালিকা আইটেমগুলি এখন ARIA ভূমিকা সহ কীবোর্ড-নেভিগেবল। টোস্ট বিজ্ঞপ্তিগুলি স্ক্রিন রিডারে ঘোষিত হয়।", ca: "Els elements de la llista de pestanyes ara són navegables per teclat amb rols ARIA. Les notificacions s'anuncien als lectors de pantalla.", cs: "Položky seznamu karet jsou nyní navigovatelné klávesnicí s rolemi ARIA. Oznámení jsou ohlašována čtečkám obrazovky.", da: "Faneliste-elementer kan nu navigeres med tastatur med ARIA-roller. Notifikationer annonceres til skærmlæsere.", el: "Τα στοιχεία λίστας καρτελών μπορούν πλέον να πλοηγηθούν με πληκτρολόγιο με ρόλους ARIA. Οι ειδοποιήσεις ανακοινώνονται σε αναγνώστες οθόνης.", et: "Vahelehe loendi elemendid on nüüd klaviatuuriga navigeeritavad ARIA rollidega. Teavitused edastatakse ekraanilugejatele.", fa: "آیتم‌های لیست تب‌ها اکنون با نقش‌های ARIA قابل پیمایش با صفحه‌کلید هستند. اعلان‌ها به صفحه‌خوان‌ها اعلام می‌شوند.", fi: "Välilehtiluettelon kohteet ovat nyt navigoitavissa näppäimistöllä ARIA-rooleilla. Ilmoitukset tiedotetaan ruudunlukijoille.", fil: "Ang mga item sa tab list ay keyboard-navigable na ngayon na may ARIA roles. Ang mga toast notification ay ina-announce sa mga screen reader.", gu: "ટૅબ સૂચિ આઇટમ હવે ARIA ભૂમિકાઓ સાથે કીબોર્ડ-નેવિગેબલ છે. ટોસ્ટ સૂચનાઓ સ્ક્રીન રીડર્સને જાહેર કરાય છે.", he: "פריטי רשימת הכרטיסיות ניתנים כעת לניווט במקלדת עם תפקידי ARIA. התראות מוכרזות לקוראי מסך.", hr: "Stavke popisa kartica sada su navigabilne tipkovnicom s ARIA ulogama. Obavijesti se objavljuju čitačima zaslona.", hu: "A laplistaelemek most billentyűzettel navigálhatók ARIA-szerepekkel. Az értesítések képernyőolvasóknak kerülnek bejelentésre.", id: "Item daftar tab sekarang dapat dinavigasi keyboard dengan peran ARIA. Notifikasi diumumkan ke pembaca layar.", kn: "ಟ್ಯಾಬ್ ಪಟ್ಟಿ ಐಟಂಗಳು ಈಗ ARIA ಪಾತ್ರಗಳೊಂದಿಗೆ ಕೀಬೋರ್ಡ್-ನ್ಯಾವಿಗೇಬಲ್ ಆಗಿವೆ. ಟೋಸ್ಟ್ ಅಧಿಸೂಚನೆಗಳು ಸ್ಕ್ರೀನ್ ರೀಡರ್‌ಗಳಿಗೆ ಘೋಷಿಸಲ್ಪಡುತ್ತವೆ.", lt: "Skirtukų sąrašo elementai dabar yra naršomi klaviatūra su ARIA vaidmenimis. Pranešimai skelbiami ekrano skaitytuvams.", lv: "Ciļņu saraksta elementi tagad ir navigējami ar tastatūru ar ARIA lomām. Paziņojumi tiek paziņoti ekrāna lasītājiem.", ml: "ടാബ് ലിസ്റ്റ് ഇനങ്ങൾ ഇപ്പോൾ ARIA റോളുകളോടെ കീബോർഡ്-നാവിഗേറ്റ് ചെയ്യാവുന്നതാണ്. ടോസ്റ്റ് അറിയിപ്പുകൾ സ്ക്രീൻ റീഡറുകൾക്ക് അറിയിക്കുന്നു.", mr: "टॅब सूची आयटम आता ARIA भूमिकांसह कीबोर्ड-नेव्हिगेबल आहेत. टोस्ट सूचना स्क्रीन रीडर्सना सूचित केल्या जातात.", ms: "Item senarai tab kini boleh dinavigasi melalui papan kekunci dengan peranan ARIA. Pemberitahuan diumumkan kepada pembaca skrin.", nb: "Faneliste-elementer er nå tastaturnavigerbare med ARIA-roller. Varsler annonseres til skjermlesere.", nl: "Tablijstitems zijn nu navigeerbaar met het toetsenbord met ARIA-rollen. Meldingen worden aangekondigd aan schermlezers.", no: "Faneliste-elementer er nå tastaturnavigerbare med ARIA-roller. Varsler annonseres til skjermlesere.", or: "ଟ୍ୟାବ୍ ତାଲିକା ଆଇଟମ୍ ଏବେ ARIA ଭୂମିକା ସହ କୀବୋର୍ଡ-ନ୍ୟାଭିଗେବଲ। ଟୋଷ୍ଟ ବିଜ୍ଞପ୍ତି ସ୍କ୍ରିନ ରିଡର୍ ପାଇଁ ଘୋଷଣା କରାଯାଏ।", pl: "Elementy listy kart są teraz nawigowalne klawiaturą z rolami ARIA. Powiadomienia są ogłaszane czytnikom ekranu.", ro: "Elementele listei de file sunt acum navigabile cu tastatura cu roluri ARIA. Notificările sunt anunțate cititorelor de ecran.", sk: "Položky zoznamu kariet sú teraz navigovateľné klávesnicou s rolami ARIA. Oznámenia sú oznamované čítačkám obrazovky.", sl: "Elementi seznama zavihkov so zdaj navigabilni s tipkovnico z vlogami ARIA. Obvestila se napovedujejo bralnikom zaslona.", sr: "Ставке листе картица сада су навигативне тастатуром са ARIA улогама. Обавештења се објављују читачима екрана.", sv: "Fliklisteobjekt kan nu navigeras med tangentbordet med ARIA-roller. Aviseringar meddelas till skärmläsare.", sw: "Vipengee vya orodha ya tabo sasa vinaweza kuzungukwa kwa kibodi kwa majukumu ya ARIA. Arifa zinatangazwa kwa wasomaji wa skrini.", ta: "தாவல் பட்டியல் உருப்படிகள் இப்போது ARIA பாத்திரங்களுடன் விசைப்பலகை-வழிசெலுத்தக்கூடியவை. டோஸ்ட் அறிவிப்புகள் திரை வாசகர்களுக்கு அறிவிக்கப்படுகின்றன.", te: "ట్యాబ్ జాబితా ఐటమ్‌లు ఇప్పుడు ARIA పాత్రలతో కీబోర్డ్-నావిగేట్ చేయగలవు. టోస్ట్ నోటిఫికేషన్‌లు స్క్రీన్ రీడర్‌లకు ప్రకటించబడతాయి.", th: "รายการแท็บสามารถนำทางด้วยแป้นพิมพ์ได้พร้อมบทบาท ARIA การแจ้งเตือนถูกประกาศให้โปรแกรมอ่านหน้าจอ", uk: "Елементи списку вкладок тепер доступні з клавіатури з ролями ARIA. Сповіщення оголошуються програмам зчитування з екрана.", vi: "Các mục danh sách tab giờ có thể điều hướng bằng bàn phím với vai trò ARIA. Thông báo được đọc cho trình đọc màn hình." };

T.changelogAnimationsTitle = { am: "ለስላሳ አኒሜሽኖች", bg: "По-плавни анимации", bn: "মসৃণ অ্যানিমেশন", ca: "Animacions més suaus", cs: "Plynulejší animace", da: "Glattere animationer", el: "Ομαλότερα κινούμενα σχέδια", et: "Sujuvamad animatsioonid", fa: "انیمیشن‌های روان‌تر", fi: "Sulavammat animaatiot", fil: "Mas Maayos na Animations", gu: "સરળ એનિમેશન", he: "אנימציות חלקות יותר", hr: "Glatkije animacije", hu: "Simább animációk", id: "Animasi Lebih Halus", kn: "ಸುಗಮ ಅನಿಮೇಶನ್‌ಗಳು", lt: "Sklandesnės animacijos", lv: "Vienmērīgākas animācijas", ml: "സുഗമമായ ആനിമേഷനുകൾ", mr: "सुगम अॅनिमेशन", ms: "Animasi Lebih Lancar", nb: "Jevnere animasjoner", nl: "Vloeiendere animaties", no: "Jevnere animasjoner", or: "ସୁଗମ ଆନିମେସନ", pl: "Płynniejsze animacje", ro: "Animații mai fluide", sk: "Plynulejšie animácie", sl: "Gladkejše animacije", sr: "Глаткије анимације", sv: "Jämnare animationer", sw: "Uhuishaji Laini", ta: "மென்மையான அனிமேஷன்கள்", te: "మృదువైన యానిమేషన్‌లు", th: "แอนิเมชันที่ลื่นขึ้น", uk: "Плавніші анімації", vi: "Hoạt ảnh mượt mà hơn" };

T.changelogAnimationsDesc = { am: "የትሮች ዝርዝር ቅደም ተከተል አኒሜሽኖች ከፍተኛ ገደብ ተቀምጧል ስለዚህ ብዙ ትሮች ያሉ መስኮቶች ረጅም መዘግየት አይኖራቸውም።", bg: "Каскадните анимации на списъка с раздели вече са ограничени, за да се избегнат дълги забавяния.", bn: "ট্যাব তালিকার স্ট্যাগার অ্যানিমেশন সীমিত করা হয়েছে যাতে অনেক ট্যাবের উইন্ডোতে দীর্ঘ বিলম্ব না হয়।", ca: "Les animacions escalonades estan limitades perquè les finestres amb moltes pestanyes no tinguin retards llargs.", cs: "Postupné animace seznamu karet jsou nyní omezeny, aby okna s mnoha kartami neměla dlouhé zpoždění.", da: "Forskudte animationer er nu begrænset, så vinduer med mange faner ikke har en lang kaskade-forsinkelse.", el: "Τα κλιμακωτά εφέ κίνησης είναι πλέον περιορισμένα ώστε τα παράθυρα με πολλές καρτέλες να μην έχουν μεγάλη καθυστέρηση.", et: "Vahelehe loendi hajutatud animatsioonid on nüüd piiratud, et paljude vahelehededega akendel ei oleks pikka viivitust.", fa: "انیمیشن‌های پلکانی لیست تب‌ها اکنون محدود شده‌اند تا پنجره‌هایی با تعداد زیاد تب تأخیر طولانی نداشته باشند.", fi: "Välilehtilistan porrastetut animaatiot on nyt rajoitettu, jotta ikkunoissa, joissa on paljon välilehtiä, ei ole pitkää viivettä.", fil: "Ang stagger animations ng tab list ay may cap na para hindi magkaroon ng mahabang delay ang mga window na may maraming tab.", gu: "ટૅબ સૂચિ સ્ટેગર એનિમેશન હવે મર્યાદિત છે જેથી ઘણા ટૅબ્સવાળી વિન્ડોઝમાં લાંબો વિલંબ ન થાય.", he: "אנימציות מדורגות מוגבלות כעת כך שחלונות עם כרטיסיות רבות לא יחוו עיכוב ארוך.", hr: "Kaskadne animacije su sada ograničene tako da prozori s mnogo kartica nemaju dugo kašnjenje.", hu: "A lépcsőzetes animációk most korlátozottak, hogy a sok lappal rendelkező ablakoknak ne legyen hosszú késleltetése.", id: "Animasi bertahap daftar tab sekarang dibatasi sehingga jendela dengan banyak tab tidak memiliki penundaan panjang.", kn: "ಟ್ಯಾಬ್ ಪಟ್ಟಿ ಸ್ಟ್ಯಾಗರ್ ಅನಿಮೇಶನ್‌ಗಳು ಈಗ ಮಿತಿಯಲ್ಲಿವೆ ಆದ್ದರಿಂದ ಅನೇಕ ಟ್ಯಾಬ್‌ಗಳಿರುವ ವಿಂಡೋಗಳಲ್ಲಿ ದೀರ್ಘ ವಿಳಂಬ ಇರುವುದಿಲ್ಲ.", lt: "Skirtukų sąrašo pakopinės animacijos dabar yra apribotos, todėl langai su daugeliu skirtukų neturi ilgo vėlavimo.", lv: "Ciļņu saraksta pakāpeniskās animācijas tagad ir ierobežotas, lai logi ar daudzām cilnēm neradītu ilgu aizkavi.", ml: "ടാബ് ലിസ്റ്റ് സ്റ്റാഗർ ആനിമേഷനുകൾ ഇപ്പോൾ പരിമിതപ്പെടുത്തിയിരിക്കുന്നു, അതിനാൽ നിരവധി ടാബുകളുള്ള വിൻഡോകളിൽ ദീർഘ കാലതാമസം ഉണ്ടാകില്ല.", mr: "टॅब सूची स्टॅगर अॅनिमेशन आता मर्यादित आहेत जेणेकरून अनेक टॅबसह विंडोंना दीर्घ विलंब होणार नाही.", ms: "Animasi berperingkat senarai tab kini dihadkan supaya tetingkap dengan banyak tab tidak mempunyai kelewatan panjang.", nb: "Forskjøvne animasjoner er nå begrenset slik at vinduer med mange faner ikke har lang forsinkelse.", nl: "Gespreide animaties zijn nu begrensd zodat vensters met veel tabbladen geen lange trapsgewijze vertraging hebben.", no: "Forskjøvne animasjoner er nå begrenset slik at vinduer med mange faner ikke har lang forsinkelse.", or: "ଟ୍ୟାବ୍ ତାଲିକା ଷ୍ଟ୍ୟାଗର ଆନିମେସନ ଏବେ ସୀମିତ ଯାହା ଫଳରେ ଅନେକ ଟ୍ୟାବ୍ ଥିବା ୱିଣ୍ଡୋରେ ଲମ୍ବା ବିଳମ୍ବ ହୁଏ ନାହିଁ।", pl: "Animacje kaskadowe listy kart są teraz ograniczone, więc okna z wieloma kartami nie mają długiego opóźnienia.", ro: "Animațiile în cascadă sunt limitate pentru a evita întârzieri lungi în ferestrele cu multe file.", sk: "Kaskádové animácie zoznamu kariet sú teraz obmedzené, takže okná s mnohými kartami nemajú dlhé oneskorenie.", sl: "Stopničaste animacije seznama zavihkov so zdaj omejene, da okna z veliko zavihki nimajo dolgih zakasnitev.", sr: "Каскадне анимације листе картица су сада ограничене тако да прозори са много картица немају дуго кашњење.", sv: "Stegade animationer är nu begränsade så att fönster med många flikar inte har en lång kaskadförsening.", sw: "Uhuishaji wa hatua kwa hatua wa orodha ya tabo sasa umezuiwa ili madirisha yenye tabo nyingi yasiwe na ucheleweshaji mrefu.", ta: "தாவல் பட்டியல் படிநிலை அனிமேஷன்கள் இப்போது வரம்பிடப்பட்டுள்ளன, எனவே பல தாவல்கள் கொண்ட சாளரங்களில் நீண்ட தாமதம் இருக்காது.", te: "ట్యాబ్ జాబితా స్ట్యాగర్ యానిమేషన్‌లు ఇప్పుడు పరిమితం చేయబడ్డాయి కాబట్టి అనేక ట్యాబ్‌లు ఉన్న విండోలలో సుదీర్ఘ ఆలస్యం ఉండదు.", th: "แอนิเมชันแบบเรียงลำดับถูกจำกัดแล้ว หน้าต่างที่มีแท็บจำนวนมากจะไม่มีการหน่วงเวลานาน", uk: "Каскадні анімації списку вкладок тепер обмежені, тому вікна з багатьма вкладками не мають тривалої затримки.", vi: "Hoạt ảnh xen kẽ danh sách tab giờ được giới hạn để cửa sổ có nhiều tab không bị trễ lâu." };

T.changelogCtaText = { am: "Drowzy ነፃ እና ክፍት ምንጭ ነው። ማህደረ ትውስታ እየቆጠበ ከሆነ ግምገማ ወይም በ GitHub ላይ ኮከብ ያስቀምጡ።", bg: "Drowzy е безплатен и с отворен код. Ако ви спестява памет, оставете рецензия или звезда в GitHub.", bn: "Drowzy বিনামূল্যে এবং ওপেন সোর্স। মেমোরি সাশ্রয় করলে একটি রিভিউ দিন বা GitHub-এ স্টার দিন।", ca: "Drowzy és gratuït i de codi obert. Si us estalvia memòria, deixeu una ressenya o una estrella a GitHub.", cs: "Drowzy je zdarma a open source. Pokud vám šetří paměť, zanechte recenzi nebo hvězdičku na GitHubu.", da: "Drowzy er gratis og open source. Hvis den sparer dig hukommelse, overvej at give en anmeldelse eller stjerne på GitHub.", el: "Το Drowzy είναι δωρεάν και ανοιχτού κώδικα. Αν σας εξοικονομεί μνήμη, αφήστε μια αξιολόγηση ή ένα αστέρι στο GitHub.", et: "Drowzy on tasuta ja avatud lähtekoodiga. Kui see säästab teile mälu, jätke arvustus või tärn GitHubis.", fa: "Drowzy رایگان و متن‌باز است. اگر حافظه شما را صرفه‌جویی می‌کند، یک بررسی بگذارید یا در GitHub ستاره بدهید.", fi: "Drowzy on ilmainen ja avoimen lähdekoodin. Jos se säästää muistiasi, harkitse arvostelun jättämistä tai tähden antamista GitHubissa.", fil: "Ang Drowzy ay libre at open source. Kung nakakatipid ito ng memory, mag-iwan ng review o mag-star sa GitHub.", gu: "Drowzy મફત અને ઓપન સોર્સ છે. જો તે મેમરી બચાવે છે, તો સમીક્ષા અથવા GitHub પર સ્ટાર આપો.", he: "Drowzy חינמי ובקוד פתוח. אם הוא חוסך לכם זיכרון, השאירו ביקורת או כוכב ב-GitHub.", hr: "Drowzy je besplatan i otvorenog koda. Ako vam štedi memoriju, ostavite recenziju ili zvjezdicu na GitHubu.", hu: "A Drowzy ingyenes és nyílt forráskódú. Ha memóriát takarít meg, hagyjon értékelést vagy csillagot a GitHubon.", id: "Drowzy gratis dan open source. Jika menghemat memori, tinggalkan ulasan atau bintang di GitHub.", kn: "Drowzy ಉಚಿತ ಮತ್ತು ಮುಕ್ತ ಮೂಲವಾಗಿದೆ. ಇದು ಮೆಮೊರಿ ಉಳಿಸುತ್ತಿದ್ದರೆ, ವಿಮರ್ಶೆ ಅಥವಾ GitHub ನಲ್ಲಿ ನಕ್ಷತ್ರ ನೀಡಿ.", lt: "Drowzy yra nemokamas ir atviro kodo. Jei jis taupo jūsų atmintį, palikite atsiliepimą arba žvaigždutę GitHub.", lv: "Drowzy ir bezmaksas un atvērtā koda. Ja tas ietaupa atmiņu, atstājiet atsauksmi vai zvaigznīti GitHub.", ml: "Drowzy സൗജന്യവും ഓപ്പൺ സോഴ്‌സും ആണ്. മെമ്മറി ലാഭിക്കുന്നുണ്ടെങ്കിൽ, അവലോകനം നൽകുക അല്ലെങ്കിൽ GitHub-ൽ നക്ഷത്രം നൽകുക.", mr: "Drowzy मोफत आणि ओपन सोर्स आहे. मेमरी वाचवत असल्यास, पुनरावलोकन द्या किंवा GitHub वर स्टार द्या.", ms: "Drowzy percuma dan sumber terbuka. Jika ia menjimatkan memori, tinggalkan ulasan atau bintang di GitHub.", nb: "Drowzy er gratis og åpen kildekode. Hvis den sparer deg minne, gi en anmeldelse eller stjerne på GitHub.", nl: "Drowzy is gratis en open source. Als het geheugen bespaart, laat dan een beoordeling achter of geef een ster op GitHub.", no: "Drowzy er gratis og åpen kildekode. Hvis den sparer deg minne, gi en anmeldelse eller stjerne på GitHub.", or: "Drowzy ମାଗଣା ଏବଂ ଓପେନ ସୋର୍ସ। ଯଦି ଏହା ମେମୋରୀ ସଞ୍ଚୟ କରୁଛି, ସମୀକ୍ଷା ଦିଅନ୍ତୁ ବା GitHub ରେ ଷ୍ଟାର୍ ଦିଅନ୍ତୁ।", pl: "Drowzy jest darmowy i open source. Jeśli oszczędza pamięć, zostaw opinię lub gwiazdkę na GitHubie.", ro: "Drowzy este gratuit și open source. Dacă vă economisește memorie, lăsați o recenzie sau o stea pe GitHub.", sk: "Drowzy je zadarmo a open source. Ak vám šetrí pamäť, zanechajte recenziu alebo hviezdičku na GitHube.", sl: "Drowzy je brezplačen in odprtokoden. Če vam prihrani pomnilnik, pustite oceno ali zvezdico na GitHubu.", sr: "Drowzy је бесплатан и отвореног кода. Ако вам штеди меморију, оставите рецензију или звездицу на GitHub-у.", sv: "Drowzy är gratis och öppen källkod. Om det sparar minne, överväg att lämna ett omdöme eller en stjärna på GitHub.", sw: "Drowzy ni bure na chanzo huria. Ikiwa inakuokoa kumbukumbu, fikiria kuacha ukaguzi au nyota kwenye GitHub.", ta: "Drowzy இலவசம் மற்றும் திறந்த மூலம். நினைவகம் சேமிக்கிறது என்றால், மதிப்பாய்வு அல்லது GitHub-இல் நட்சத்திரம் கொடுங்கள்.", te: "Drowzy ఉచితం మరియు ఓపెన్ సోర్స్. మెమరీ ఆదా చేస్తుంటే, సమీక్ష లేదా GitHub లో స్టార్ ఇవ్వండి.", th: "Drowzy ฟรีและโอเพ่นซอร์ส หากประหยัดหน่วยความจำได้ ลองเขียนรีวิวหรือให้ดาวบน GitHub", uk: "Drowzy безкоштовний та з відкритим кодом. Якщо він економить пам'ять, залиште відгук або зірку на GitHub.", vi: "Drowzy miễn phí và mã nguồn mở. Nếu tiết kiệm bộ nhớ cho bạn, hãy để lại đánh giá hoặc gắn sao trên GitHub." };

T.changelogReviewBtn = { am: "ግምገማ ይስጡ", bg: "Оставете рецензия", bn: "রিভিউ দিন", ca: "Deixa una ressenya", cs: "Zanechat recenzi", da: "Skriv en anmeldelse", el: "Αφήστε αξιολόγηση", et: "Jäta arvustus", fa: "بررسی بگذارید", fi: "Jätä arvostelu", fil: "Mag-iwan ng Review", gu: "સમીક્ષા આપો", he: "השאר ביקורת", hr: "Ostavite recenziju", hu: "Értékelés írása", id: "Tinggalkan Ulasan", kn: "ವಿಮರ್ಶೆ ನೀಡಿ", lt: "Palikti atsiliepimą", lv: "Atstāt atsauksmi", ml: "അവലോകനം നൽകുക", mr: "पुनरावलोकन द्या", ms: "Tinggalkan Ulasan", nb: "Gi en anmeldelse", nl: "Laat een beoordeling achter", no: "Gi en anmeldelse", or: "ସମୀକ୍ଷା ଦିଅନ୍ତୁ", pl: "Zostaw opinię", ro: "Lăsați o recenzie", sk: "Zanechať recenziu", sl: "Pustite oceno", sr: "Оставите рецензију", sv: "Lämna ett omdöme", sw: "Acha Ukaguzi", ta: "மதிப்பாய்வு கொடுங்கள்", te: "సమీక్ష ఇవ్వండి", th: "เขียนรีวิว", uk: "Залишити відгук", vi: "Để lại đánh giá" };

T.changelogStarBtn = { am: "GitHub ላይ ኮከብ", bg: "Звезда в GitHub", bn: "GitHub-এ স্টার", ca: "Estrella a GitHub", cs: "Hvězdička na GitHubu", da: "Stjerne på GitHub", el: "Αστέρι στο GitHub", et: "Täht GitHubis", fa: "ستاره در GitHub", fi: "Tähti GitHubissa", fil: "Star sa GitHub", gu: "GitHub પર સ્ટાર", he: "כוכב ב-GitHub", hr: "Zvjezdica na GitHubu", hu: "Csillag a GitHubon", id: "Bintang di GitHub", kn: "GitHub ನಲ್ಲಿ ನಕ್ಷತ್ರ", lt: "Žvaigždutė GitHub", lv: "Zvaigznīte GitHub", ml: "GitHub-ൽ നക്ഷത്രം", mr: "GitHub वर स्टार", ms: "Bintang di GitHub", nb: "Stjerne på GitHub", nl: "Ster op GitHub", no: "Stjerne på GitHub", or: "GitHub ରେ ଷ୍ଟାର୍", pl: "Gwiazdka na GitHubie", ro: "Stea pe GitHub", sk: "Hviezdička na GitHube", sl: "Zvezdica na GitHubu", sr: "Звездица на GitHub-у", sv: "Stjärna på GitHub", sw: "Nyota kwenye GitHub", ta: "GitHub-இல் நட்சத்திரம்", te: "GitHub లో స్టార్", th: "ให้ดาวบน GitHub", uk: "Зірка на GitHub", vi: "Gắn sao trên GitHub" };

// Now apply all translations to each locale file
const locales = fs.readdirSync(__dirname).filter(d => {
  const p = path.join(__dirname, d);
  return fs.statSync(p).isDirectory() && d !== "en" && !d.startsWith("en_");
});

let filesUpdated = 0;
let keysFixed = 0;

for (const loc of locales) {
  const filePath = path.join(__dirname, loc, "messages.json");
  if (!fs.existsSync(filePath)) continue;

  const msgs = JSON.parse(fs.readFileSync(filePath, "utf8"));
  let changed = false;

  for (const [key, localeTranslations] of Object.entries(T)) {
    if (!localeTranslations[loc]) continue; // No translation for this locale
    if (SKIP_KEYS.has(key)) continue;
    if (LEGITIMATE_MATCHES[loc] && LEGITIMATE_MATCHES[loc].has(key)) continue;

    // Check if this key needs updating (is English or missing)
    const needsUpdate = !msgs[key] || msgs[key].message === en[key].message;
    if (!needsUpdate) continue;

    // Build the replacement entry
    const newEntry = { message: localeTranslations[loc] };

    // Copy over placeholders from English if they exist
    if (en[key].placeholders) {
      newEntry.placeholders = JSON.parse(JSON.stringify(en[key].placeholders));
    }

    msgs[key] = newEntry;
    changed = true;
    keysFixed++;
  }

  if (changed) {
    fs.writeFileSync(filePath, JSON.stringify(msgs, null, 2) + "\n", "utf8");
    filesUpdated++;
  }
}

console.log(`Updated ${filesUpdated} locale files, fixed ${keysFixed} keys total.`);

// Now verify
let remainingIssues = 0;
for (const loc of locales) {
  const filePath = path.join(__dirname, loc, "messages.json");
  if (!fs.existsSync(filePath)) continue;
  const msgs = JSON.parse(fs.readFileSync(filePath, "utf8"));
  for (const k of enKeys) {
    if (SKIP_KEYS.has(k)) continue;
    if (LEGITIMATE_MATCHES[loc] && LEGITIMATE_MATCHES[loc].has(k)) continue;
    if (!msgs[k]) {
      console.log(`MISSING: ${loc}/${k}`);
      remainingIssues++;
    } else if (msgs[k].message === en[k].message) {
      console.log(`STILL ENGLISH: ${loc}/${k}`);
      remainingIssues++;
    }
  }
}
console.log(`Remaining issues: ${remainingIssues}`);
