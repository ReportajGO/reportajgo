import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const CATEGORIES = ["world", "economics", "sport", "culture", "tech"] as const;
const LANGS = ["uz", "ru", "en"] as const;

// Trilingual sample content ported from the ReportajGO prototype.
type Article = {
  cat: (typeof CATEGORIES)[number];
  author: string;
  breaking?: boolean;
  minsAgo: number;
  t: Record<string, string>;
  s: Record<string, string>;
  b: Record<string, string[]>;
};

const ARTICLES: Article[] = [
  {
    cat: "world",
    author: "D. Karimova",
    breaking: true,
    minsAgo: 18,
    t: {
      uz: "Markaziy Osiyo davlatlari yagona suv kelishuvini imzoladi",
      ru: "Страны Центральной Азии подписали единое водное соглашение",
      en: "Central Asian states sign a single water-sharing accord",
    },
    s: {
      uz: "Mintaqaviy sammitda besh davlat transchegaraviy daryolarni boshqarish bo‘yicha kelishdi.",
      ru: "На региональном саммите пять государств договорились о совместном управлении трансграничными реками.",
      en: "Five states agreed at a regional summit to jointly manage their cross-border rivers.",
    },
    b: {
      uz: [
        "Sammit ikki kun davom etdi va mintaqadagi eng katta diplomatik voqealardan biriga aylandi.",
        "Kelishuv suv resurslarini taqsimlash bo‘yicha aniq mexanizmni belgilaydi va kuzatuv kengashini tashkil etadi.",
        "Tahlilchilarning fikricha, bu hujjat keyingi o‘n yil uchun mintaqaviy barqarorlikning asosi bo‘lishi mumkin.",
      ],
      ru: [
        "Саммит продлился два дня и стал одним из крупнейших дипломатических событий региона.",
        "Соглашение устанавливает чёткий механизм распределения водных ресурсов и создаёт наблюдательный совет.",
        "Аналитики считают, что документ может стать опорой региональной стабильности на ближайшее десятилетие.",
      ],
      en: [
        "The summit ran for two days and became one of the region's largest diplomatic events.",
        "The accord sets a clear mechanism for sharing water resources and creates a monitoring council.",
        "Analysts say the document could anchor regional stability for the coming decade.",
      ],
    },
  },
  {
    cat: "economics",
    author: "R. Yusupov",
    minsAgo: 42,
    t: {
      uz: "Markaziy bank asosiy stavkani o‘zgarishsiz qoldirdi",
      ru: "Центробанк сохранил ключевую ставку без изменений",
      en: "Central bank holds its benchmark rate steady",
    },
    s: {
      uz: "Regulyator inflyatsiya sekinlashayotganini ta’kidladi, ammo ehtiyotkorlikni saqlab qoldi.",
      ru: "Регулятор отметил замедление инфляции, но сохранил осторожный тон.",
      en: "The regulator pointed to easing inflation but kept a cautious tone.",
    },
    b: {
      uz: [
        "Qaror bozor kutganidek bo‘ldi.",
        "Regulyator yil oxiriga qadar inflyatsiya maqsadli koridorga qaytishini bashorat qilmoqda.",
        "Keyingi yig‘ilish bir oydan so‘ng bo‘lib o‘tadi.",
      ],
      ru: [
        "Решение совпало с ожиданиями рынка.",
        "Регулятор прогнозирует возвращение инфляции в целевой коридор к концу года.",
        "Следующее заседание состоится через месяц.",
      ],
      en: [
        "The decision matched market expectations.",
        "The regulator forecasts inflation returning to its target band by year-end.",
        "The next meeting is scheduled in a month.",
      ],
    },
  },
  {
    cat: "sport",
    author: "A. Tashkentov",
    minsAgo: 55,
    t: {
      uz: "Milliy terma jamoa hal qiluvchi o‘yinda g‘alaba qozondi",
      ru: "Сборная вырвала победу в решающем матче",
      en: "National team snatches a decisive win",
    },
    s: {
      uz: "Qo‘shimcha vaqtda urilgan gol jamoani keyingi bosqichga olib chiqdi.",
      ru: "Гол в добавленное время вывел команду в следующий раунд.",
      en: "A stoppage-time goal sent the side through to the next round.",
    },
    b: {
      uz: [
        "Stadion to‘la edi va muxlislar oxirgi daqiqagacha kutdi.",
        "Murabbiy o‘yindan keyin jamoaning xarakterini alohida ta’kidladi.",
        "Keyingi o‘yin bir hafta ichida bo‘lib o‘tadi.",
      ],
      ru: [
        "Стадион был полон, болельщики ждали до последней минуты.",
        "После матча тренер особо отметил характер команды.",
        "Следующая игра состоится в течение недели.",
      ],
      en: [
        "The stadium was full and fans waited until the final minute.",
        "After the match the coach singled out the team's character.",
        "The next game takes place within a week.",
      ],
    },
  },
  {
    cat: "culture",
    author: "N. Olimova",
    minsAgo: 80,
    t: {
      uz: "Toshkentda zamonaviy san’at biennalesi ochildi",
      ru: "В Ташкенте открылась биеннале современного искусства",
      en: "A contemporary art biennial opens in Tashkent",
    },
    s: {
      uz: "Yigirmadan ortiq mamlakatdan rassomlar an’ana va texnologiya chorrahasini taqdim etmoqda.",
      ru: "Художники из более чем двадцати стран показывают пересечение традиции и технологий.",
      en: "Artists from over twenty countries explore where tradition meets technology.",
    },
    b: {
      uz: [
        "Ko‘rgazma uch oy davom etadi.",
        "Tashkilotchilar yoshlar uchun bepul ekskursiyalar tashkil etgan.",
        "Markaziy asar — interaktiv yorug‘lik inshooti.",
      ],
      ru: [
        "Выставка продлится три месяца.",
        "Организаторы устроили бесплатные экскурсии для молодёжи.",
        "Центральный экспонат — интерактивная световая инсталляция.",
      ],
      en: [
        "The exhibition runs for three months.",
        "Organizers arranged free tours for young visitors.",
        "The centrepiece is an interactive light installation.",
      ],
    },
  },
  {
    cat: "tech",
    author: "S. Rahmonov",
    minsAgo: 120,
    t: {
      uz: "Mahalliy startap qishloq xo‘jaligi uchun AI platformasini ishga tushirdi",
      ru: "Местный стартап запустил ИИ-платформу для сельского хозяйства",
      en: "Local startup launches an AI platform for farming",
    },
    s: {
      uz: "Tizim sun’iy yo‘ldosh tasvirlari asosida hosildorlikni bashorat qiladi.",
      ru: "Система прогнозирует урожайность на основе спутниковых снимков.",
      en: "The system forecasts crop yields from satellite imagery.",
    },
    b: {
      uz: [
        "Pilot loyiha o‘nlab fermer xo‘jaliklarini qamrab oldi.",
        "Ishlab chiquvchilar aniqlik 90 foizdan oshganini aytmoqda.",
        "Keyingi bosqichda platforma mintaqa bo‘ylab kengaytiriladi.",
      ],
      ru: [
        "Пилот охватил десятки фермерских хозяйств.",
        "Разработчики заявляют о точности выше 90 процентов.",
        "На следующем этапе платформу масштабируют на весь регион.",
      ],
      en: [
        "The pilot covered dozens of farms.",
        "Developers claim accuracy above 90 percent.",
        "The next phase will scale the platform across the region.",
      ],
    },
  },
  {
    cat: "world",
    author: "L. Eshonova",
    minsAgo: 150,
    t: {
      uz: "Yevropa shaharlari rekord issiqlikka qarshi chora ko‘rmoqda",
      ru: "Города Европы борются с рекордной жарой",
      en: "European cities respond to record heat",
    },
    s: {
      uz: "Hokimiyatlar suv tarqatish punktlari ochib, ish vaqtini o‘zgartirmoqda.",
      ru: "Власти открывают пункты раздачи воды и меняют рабочие часы.",
      en: "Authorities are opening water points and shifting working hours.",
    },
    b: {
      uz: [
        "Bir qator shaharlarda transport jadvali ham o‘zgartirildi.",
        "Shifokorlar keksalarga alohida e’tibor qaratishni so‘ramoqda.",
        "Ob-havo prognozi keyingi haftada yengillik va’da qilmoqda.",
      ],
      ru: [
        "В ряде городов изменено и расписание транспорта.",
        "Врачи просят особенно внимательно относиться к пожилым.",
        "Прогноз обещает облегчение на следующей неделе.",
      ],
      en: [
        "Several cities have also adjusted transit schedules.",
        "Doctors urge extra care for the elderly.",
        "The forecast promises relief next week.",
      ],
    },
  },
  {
    cat: "economics",
    author: "R. Yusupov",
    minsAgo: 200,
    t: {
      uz: "Eksport ko‘rsatkichlari to‘qimachilik hisobiga o‘sdi",
      ru: "Экспорт вырос за счёт текстильной отрасли",
      en: "Exports rise on the back of textiles",
    },
    s: {
      uz: "To‘qimachilik mahsulotlari chorak yakunlari bo‘yicha asosiy o‘sish manbai bo‘ldi.",
      ru: "Текстиль стал главным драйвером роста по итогам квартала.",
      en: "Textiles were the main growth driver for the quarter.",
    },
    b: {
      uz: [
        "Sanoatchilar yangi bozorlarga chiqqanini aytmoqda.",
        "Hukumat qo‘shimcha imtiyozlar paketini muhokama qilmoqda.",
        "Mutaxassislar trend saqlanib qolishini kutmoqda.",
      ],
      ru: [
        "Промышленники сообщают о выходе на новые рынки.",
        "Правительство обсуждает пакет дополнительных льгот.",
        "Эксперты ожидают сохранения тренда.",
      ],
      en: [
        "Manufacturers report entering new markets.",
        "The government is weighing a package of extra incentives.",
        "Experts expect the trend to hold.",
      ],
    },
  },
  {
    cat: "sport",
    author: "A. Tashkentov",
    minsAgo: 260,
    t: {
      uz: "Yosh shaxmatchi xalqaro turnirda sovrindor bo‘ldi",
      ru: "Юный шахматист стал призёром международного турнира",
      en: "Young chess player takes a podium at an international event",
    },
    s: {
      uz: "O‘n besh yoshli sportchi katta ustalarni ortda qoldirdi.",
      ru: "Пятнадцатилетний спортсмен обошёл признанных гроссмейстеров.",
      en: "The fifteen-year-old finished ahead of established grandmasters.",
    },
    b: {
      uz: [
        "Final partiyasi olti soatdan ortiq davom etdi.",
        "Murabbiy uning hisoblash tezligini maqtadi.",
        "Keyingi turnir kuzda bo‘lib o‘tadi.",
      ],
      ru: [
        "Финальная партия длилась более шести часов.",
        "Тренер похвалил скорость его расчёта.",
        "Следующий турнир пройдёт осенью.",
      ],
      en: [
        "The final game lasted more than six hours.",
        "His coach praised his calculation speed.",
        "The next tournament is in autumn.",
      ],
    },
  },
  {
    cat: "culture",
    author: "N. Olimova",
    minsAgo: 330,
    t: {
      uz: "Restavratsiya qilingan tarixiy teatr qayta ochildi",
      ru: "Отреставрированный исторический театр вновь открыт",
      en: "A restored historic theatre reopens",
    },
    s: {
      uz: "Ikki yillik ishlardan so‘ng bino dastlabki ko‘rinishiga qaytarildi.",
      ru: "После двухлетних работ зданию вернули первоначальный облик.",
      en: "After two years of work the building regained its original look.",
    },
    b: {
      uz: [
        "Ochilish marosimida klassik asar namoyish etildi.",
        "Akustika to‘liq yangilandi.",
        "Mavsumiy repertuar e’lon qilindi.",
      ],
      ru: [
        "На открытии показали классическую постановку.",
        "Полностью обновлена акустика.",
        "Объявлен репертуар сезона.",
      ],
      en: [
        "A classic production marked the opening.",
        "The acoustics were completely rebuilt.",
        "The season's repertoire has been announced.",
      ],
    },
  },
  {
    cat: "tech",
    author: "S. Rahmonov",
    minsAgo: 420,
    t: {
      uz: "Yangi ma’lumot markazi yashil energiyaga o‘tdi",
      ru: "Новый дата-центр перешёл на зелёную энергию",
      en: "New data centre switches to green energy",
    },
    s: {
      uz: "Ob’ekt quvvatining katta qismini quyosh panellaridan oladi.",
      ru: "Большую часть мощности объект получает от солнечных панелей.",
      en: "The facility draws most of its power from solar panels.",
    },
    b: {
      uz: [
        "Loyiha mahalliy ish o‘rinlarini yaratdi.",
        "Operator energiya samaradorligi yuqori ekanini ta’kidlaydi.",
        "Keyingi bosqichda quvvat ikki barobar oshiriladi.",
      ],
      ru: [
        "Проект создал местные рабочие места.",
        "Оператор подчёркивает высокую энергоэффективность.",
        "На следующем этапе мощность удвоят.",
      ],
      en: [
        "The project created local jobs.",
        "The operator stresses its high energy efficiency.",
        "Capacity will double in the next phase.",
      ],
    },
  },
  {
    cat: "world",
    author: "L. Eshonova",
    minsAgo: 560,
    t: {
      uz: "Xalqaro forumda iqlim moliyasi muhokama qilindi",
      ru: "На международном форуме обсудили климатическое финансирование",
      en: "International forum debates climate finance",
    },
    s: {
      uz: "Delegatlar rivojlanayotgan davlatlarga yordamni oshirish zarurligini ta’kidladi.",
      ru: "Делегаты подчеркнули необходимость увеличить помощь развивающимся странам.",
      en: "Delegates stressed the need to scale up support for developing nations.",
    },
    b: {
      uz: [
        "Forum uch kun davom etdi.",
        "Bir nechta yangi tashabbus e’lon qilindi.",
        "Yakuniy hujjat keyingi yig‘ilishda tasdiqlanadi.",
      ],
      ru: [
        "Форум продлился три дня.",
        "Объявлено о нескольких новых инициативах.",
        "Итоговый документ утвердят на следующей встрече.",
      ],
      en: [
        "The forum lasted three days.",
        "Several new initiatives were announced.",
        "The final document will be approved at the next meeting.",
      ],
    },
  },
  {
    cat: "economics",
    author: "R. Yusupov",
    minsAgo: 700,
    t: {
      uz: "Turizm oqimi bahorda sezilarli o‘sdi",
      ru: "Турпоток заметно вырос этой весной",
      en: "Tourist arrivals rose sharply this spring",
    },
    s: {
      uz: "Mehmonxonalar bandligi so‘nggi yillardagi eng yuqori darajaga yetdi.",
      ru: "Загрузка отелей достигла максимума за последние годы.",
      en: "Hotel occupancy hit a multi-year high.",
    },
    b: {
      uz: [
        "Yangi reyslar ochilishi oqimga turtki berdi.",
        "Kichik biznes daromad oshganini qayd etmoqda.",
        "Yoz mavsumiga tayyorgarlik boshlandi.",
      ],
      ru: [
        "Открытие новых рейсов поддержало поток.",
        "Малый бизнес фиксирует рост выручки.",
        "Началась подготовка к летнему сезону.",
      ],
      en: [
        "New flight routes boosted the flow.",
        "Small businesses report higher revenue.",
        "Preparations for the summer season have begun.",
      ],
    },
  },
];

async function main() {
  // Categories
  for (const slug of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug },
      update: {},
      create: { slug },
    });
  }

  // Admin user — credentials come from the environment so no password is
  // hardcoded or committed. Set ADMIN_EMAIL / ADMIN_PASSWORD before seeding.
  const adminEmail = process.env.ADMIN_EMAIL || "admin@reportajgo.uz";
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.length < 12) {
    throw new Error(
      "Set a strong ADMIN_PASSWORD (>=12 chars) in .env before running the seed.",
    );
  }
  const password = await bcrypt.hash(adminPassword, 12);
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { password },
    create: {
      email: adminEmail,
      name: "Editor",
      password,
      role: "admin",
    },
  });

  // Fresh posts each run
  await prisma.post.deleteMany();

  const now = Date.now();
  for (const a of ARTICLES) {
    const category = await prisma.category.findUniqueOrThrow({
      where: { slug: a.cat },
    });
    // One multilingual post per article: base text = Russian, with translations
    // for all three languages so it shows on every locale.
    const translations = Object.fromEntries(
      LANGS.map((lang) => [
        lang,
        { title: a.t[lang], excerpt: a.s[lang], body: a.b[lang].join("\n\n") },
      ]),
    );
    await prisma.post.create({
      data: {
        title: a.t.ru,
        excerpt: a.s.ru,
        body: a.b.ru.join("\n\n"),
        translations: JSON.stringify(translations),
        language: "ru",
        breaking: Boolean(a.breaking),
        published: true,
        categoryId: category.id,
        authorId: admin.id,
        createdAt: new Date(now - a.minsAgo * 60_000),
      },
    });
  }

  const count = await prisma.post.count();
  console.log(`Seeded ${count} posts, ${CATEGORIES.length} categories, 1 admin.`);
  console.log(`Admin login: ${adminEmail} (password from ADMIN_PASSWORD)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
