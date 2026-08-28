// ЧАСОВЫЕ ПОЯСА — СГРУППИРОВАННЫЕ, КАК В НАСТРОЙКАХ ТЕЛЕФОНА И НОУТБУКА.
//
// Владелец 2026-08-27: «разбивка не по городам, а по часовым поясам»;
// «некоторые будут жить в Киеве, у них такое же — сделай, чтоб было всё
// указано чётко и без всяких „либо"». Отсюда формат строки: сначала
// смещение, потом города через запятую — `(UTC+2) Helsinki, Kyiv, Riga`.
// Так пишет свой список поясов Windows, так же читается настройка в iOS:
// человек не гадает, «его» это пояс или нет, — он видит свой город.
//
// ГРУППИРОВКА ПОСУТОЧНАЯ, А НЕ ПОМЕСЯЧНАЯ. Зоны попадают в одну группу,
// только если их смещение совпало В КАЖДЫЙ ИЗ 365 ДНЕЙ года. Помесячная
// сверка (по 15-м числам) этого не ловила: Иерусалим и Газа переводят часы
// не в те же дни, что ЕС, и с ней они стояли в одной строке с Хельсинки.
// Несколько дней в году граница суток у них разъезжалась бы с европейской,
// и выручка падала бы не в те сутки. Групп: 62 из 418 зон.
//
// ИМЕНА ЗОН СОВРЕМЕННЫЕ. ICU по старой памяти отдаёт `Europe/Kiev`,
// `Asia/Calcutta`, `Asia/Saigon`, `America/Godthab` и ещё восемь
// устаревших — все переписаны в нынешние (Kyiv, Kolkata, Ho Chi Minh, Nuuk).
// Проверено: `Intl` принимает каждое новое имя.
//
// У КАЖДОГО ГОРОДА ХРАНИТСЯ СВОЯ ЗОНА. Выбравшему Киев сохраняется
// `Europe/Kyiv`, а не `Europe/Helsinki`, которым подписана группа: сегодня
// они неразличимы, но правила перевода часов меняют по странам, и
// украинский бизнес обязан следовать украинскому правилу, а не финскому.
//
// Порядок групп — по смещению в январе, с запада на восток. Порядок городов
// внутри группы — по узнаваемости: первые попадают в подпись.
//
// Сгенерировано из ICU; руками не правится.
export interface ZoneCity {
  name: string;
  zone: string;
}

export interface ZoneGroup {
  /** Сохраняется, если группу выбрали барабаном. */
  zone: string;
  /** Все города группы. Первые — самые узнаваемые. */
  cities: ZoneCity[];
}

export const ZONE_GROUPS: ZoneGroup[] = [
  {
    zone: "Pacific/Midway",
    cities: [
      { name: "Midway", zone: "Pacific/Midway" },
      { name: "Niue", zone: "Pacific/Niue" },
      { name: "Pago Pago", zone: "Pacific/Pago_Pago" },
    ],
  },
  {
    zone: "America/Adak",
    cities: [
      { name: "Adak", zone: "America/Adak" },
    ],
  },
  {
    zone: "Pacific/Honolulu",
    cities: [
      { name: "Honolulu", zone: "Pacific/Honolulu" },
      { name: "Rarotonga", zone: "Pacific/Rarotonga" },
      { name: "Tahiti", zone: "Pacific/Tahiti" },
    ],
  },
  {
    zone: "Pacific/Marquesas",
    cities: [
      { name: "Marquesas", zone: "Pacific/Marquesas" },
    ],
  },
  {
    zone: "America/Anchorage",
    cities: [
      { name: "Anchorage", zone: "America/Anchorage" },
      { name: "Juneau", zone: "America/Juneau" },
      { name: "Metlakatla", zone: "America/Metlakatla" },
      { name: "Nome", zone: "America/Nome" },
      { name: "Sitka", zone: "America/Sitka" },
      { name: "Yakutat", zone: "America/Yakutat" },
    ],
  },
  {
    zone: "Pacific/Gambier",
    cities: [
      { name: "Gambier", zone: "Pacific/Gambier" },
    ],
  },
  {
    zone: "America/Los_Angeles",
    cities: [
      { name: "Los Angeles", zone: "America/Los_Angeles" },
      { name: "Tijuana", zone: "America/Tijuana" },
    ],
  },
  {
    zone: "America/Vancouver",
    cities: [
      { name: "Vancouver", zone: "America/Vancouver" },
    ],
  },
  {
    zone: "Pacific/Pitcairn",
    cities: [
      { name: "Pitcairn", zone: "Pacific/Pitcairn" },
    ],
  },
  {
    zone: "America/Denver",
    cities: [
      { name: "Denver", zone: "America/Denver" },
      { name: "Boise", zone: "America/Boise" },
      { name: "Cambridge Bay", zone: "America/Cambridge_Bay" },
      { name: "Ciudad Juarez", zone: "America/Ciudad_Juarez" },
      { name: "Edmonton", zone: "America/Edmonton" },
      { name: "Inuvik", zone: "America/Inuvik" },
    ],
  },
  {
    zone: "America/Phoenix",
    cities: [
      { name: "Phoenix", zone: "America/Phoenix" },
      { name: "Creston", zone: "America/Creston" },
      { name: "Dawson", zone: "America/Dawson" },
      { name: "Dawson Creek", zone: "America/Dawson_Creek" },
      { name: "Fort Nelson", zone: "America/Fort_Nelson" },
      { name: "Hermosillo", zone: "America/Hermosillo" },
      { name: "Mazatlan", zone: "America/Mazatlan" },
      { name: "Whitehorse", zone: "America/Whitehorse" },
    ],
  },
  {
    zone: "America/Chicago",
    cities: [
      { name: "Chicago", zone: "America/Chicago" },
      { name: "Knox", zone: "America/Indiana/Knox" },
      { name: "Tell City", zone: "America/Indiana/Tell_City" },
      { name: "Matamoros", zone: "America/Matamoros" },
      { name: "Menominee", zone: "America/Menominee" },
      { name: "Beulah", zone: "America/North_Dakota/Beulah" },
      { name: "Center", zone: "America/North_Dakota/Center" },
      { name: "New Salem", zone: "America/North_Dakota/New_Salem" },
      { name: "Ojinaga", zone: "America/Ojinaga" },
      { name: "Rankin Inlet", zone: "America/Rankin_Inlet" },
      { name: "Resolute", zone: "America/Resolute" },
      { name: "Winnipeg", zone: "America/Winnipeg" },
    ],
  },
  {
    zone: "America/Mexico_City",
    cities: [
      { name: "Mexico City", zone: "America/Mexico_City" },
      { name: "Bahia Banderas", zone: "America/Bahia_Banderas" },
      { name: "Belize", zone: "America/Belize" },
      { name: "Chihuahua", zone: "America/Chihuahua" },
      { name: "Costa Rica", zone: "America/Costa_Rica" },
      { name: "El Salvador", zone: "America/El_Salvador" },
      { name: "Guatemala", zone: "America/Guatemala" },
      { name: "Managua", zone: "America/Managua" },
      { name: "Merida", zone: "America/Merida" },
      { name: "Monterrey", zone: "America/Monterrey" },
      { name: "Regina", zone: "America/Regina" },
      { name: "Swift Current", zone: "America/Swift_Current" },
      { name: "Tegucigalpa", zone: "America/Tegucigalpa" },
      { name: "Galapagos", zone: "Pacific/Galapagos" },
    ],
  },
  {
    zone: "America/New_York",
    cities: [
      { name: "New York", zone: "America/New_York" },
      { name: "Toronto", zone: "America/Toronto" },
      { name: "Havana", zone: "America/Havana" },
      { name: "Detroit", zone: "America/Detroit" },
      { name: "Grand Turk", zone: "America/Grand_Turk" },
      { name: "Marengo", zone: "America/Indiana/Marengo" },
      { name: "Petersburg", zone: "America/Indiana/Petersburg" },
      { name: "Vevay", zone: "America/Indiana/Vevay" },
      { name: "Vincennes", zone: "America/Indiana/Vincennes" },
      { name: "Winamac", zone: "America/Indiana/Winamac" },
      { name: "Indianapolis", zone: "America/Indianapolis" },
      { name: "Iqaluit", zone: "America/Iqaluit" },
      { name: "Monticello", zone: "America/Kentucky/Monticello" },
      { name: "Louisville", zone: "America/Louisville" },
      { name: "Nassau", zone: "America/Nassau" },
      { name: "Port-au-Prince", zone: "America/Port-au-Prince" },
    ],
  },
  {
    zone: "America/Panama",
    cities: [
      { name: "Panama", zone: "America/Panama" },
      { name: "Bogota", zone: "America/Bogota" },
      { name: "Lima", zone: "America/Lima" },
      { name: "Cancun", zone: "America/Cancun" },
      { name: "Cayman", zone: "America/Cayman" },
      { name: "Coral Harbour", zone: "America/Coral_Harbour" },
      { name: "Eirunepe", zone: "America/Eirunepe" },
      { name: "Guayaquil", zone: "America/Guayaquil" },
      { name: "Jamaica", zone: "America/Jamaica" },
      { name: "Rio Branco", zone: "America/Rio_Branco" },
    ],
  },
  {
    zone: "Pacific/Easter",
    cities: [
      { name: "Easter", zone: "Pacific/Easter" },
    ],
  },
  {
    zone: "America/Caracas",
    cities: [
      { name: "Caracas", zone: "America/Caracas" },
      { name: "La Paz", zone: "America/La_Paz" },
      { name: "Guyana", zone: "America/Guyana" },
      { name: "Anguilla", zone: "America/Anguilla" },
      { name: "Antigua", zone: "America/Antigua" },
      { name: "Aruba", zone: "America/Aruba" },
      { name: "Barbados", zone: "America/Barbados" },
      { name: "Blanc-Sablon", zone: "America/Blanc-Sablon" },
      { name: "Boa Vista", zone: "America/Boa_Vista" },
      { name: "Campo Grande", zone: "America/Campo_Grande" },
      { name: "Cuiaba", zone: "America/Cuiaba" },
      { name: "Curacao", zone: "America/Curacao" },
      { name: "Dominica", zone: "America/Dominica" },
      { name: "Grenada", zone: "America/Grenada" },
      { name: "Guadeloupe", zone: "America/Guadeloupe" },
      { name: "Kralendijk", zone: "America/Kralendijk" },
      { name: "Lower Princes", zone: "America/Lower_Princes" },
      { name: "Manaus", zone: "America/Manaus" },
      { name: "Marigot", zone: "America/Marigot" },
      { name: "Martinique", zone: "America/Martinique" },
      { name: "Montserrat", zone: "America/Montserrat" },
      { name: "Port of Spain", zone: "America/Port_of_Spain" },
      { name: "Porto Velho", zone: "America/Porto_Velho" },
      { name: "Puerto Rico", zone: "America/Puerto_Rico" },
      { name: "Santo Domingo", zone: "America/Santo_Domingo" },
      { name: "St Barthelemy", zone: "America/St_Barthelemy" },
      { name: "St Kitts", zone: "America/St_Kitts" },
      { name: "St Lucia", zone: "America/St_Lucia" },
      { name: "St Thomas", zone: "America/St_Thomas" },
      { name: "St Vincent", zone: "America/St_Vincent" },
      { name: "Tortola", zone: "America/Tortola" },
    ],
  },
  {
    zone: "America/Halifax",
    cities: [
      { name: "Halifax", zone: "America/Halifax" },
      { name: "Bermuda", zone: "Atlantic/Bermuda" },
      { name: "Glace Bay", zone: "America/Glace_Bay" },
      { name: "Goose Bay", zone: "America/Goose_Bay" },
      { name: "Moncton", zone: "America/Moncton" },
      { name: "Thule", zone: "America/Thule" },
    ],
  },
  {
    zone: "America/St_Johns",
    cities: [
      { name: "St Johns", zone: "America/St_Johns" },
    ],
  },
  {
    zone: "America/Miquelon",
    cities: [
      { name: "Miquelon", zone: "America/Miquelon" },
    ],
  },
  {
    zone: "America/Santiago",
    cities: [
      { name: "Santiago", zone: "America/Santiago" },
    ],
  },
  {
    zone: "America/Sao_Paulo",
    cities: [
      { name: "Sao Paulo", zone: "America/Sao_Paulo" },
      { name: "Buenos Aires", zone: "America/Argentina/Buenos_Aires" },
      { name: "Montevideo", zone: "America/Montevideo" },
      { name: "Asuncion", zone: "America/Asuncion" },
      { name: "Paramaribo", zone: "America/Paramaribo" },
      { name: "Araguaina", zone: "America/Araguaina" },
      { name: "La Rioja", zone: "America/Argentina/La_Rioja" },
      { name: "Rio Gallegos", zone: "America/Argentina/Rio_Gallegos" },
      { name: "Salta", zone: "America/Argentina/Salta" },
      { name: "San Juan", zone: "America/Argentina/San_Juan" },
      { name: "San Luis", zone: "America/Argentina/San_Luis" },
      { name: "Tucuman", zone: "America/Argentina/Tucuman" },
      { name: "Ushuaia", zone: "America/Argentina/Ushuaia" },
      { name: "Bahia", zone: "America/Bahia" },
      { name: "Belem", zone: "America/Belem" },
      { name: "Catamarca", zone: "America/Catamarca" },
      { name: "Cayenne", zone: "America/Cayenne" },
      { name: "Cordoba", zone: "America/Cordoba" },
      { name: "Coyhaique", zone: "America/Coyhaique" },
      { name: "Fortaleza", zone: "America/Fortaleza" },
      { name: "Jujuy", zone: "America/Jujuy" },
      { name: "Maceio", zone: "America/Maceio" },
      { name: "Mendoza", zone: "America/Mendoza" },
      { name: "Punta Arenas", zone: "America/Punta_Arenas" },
      { name: "Recife", zone: "America/Recife" },
      { name: "Santarem", zone: "America/Santarem" },
      { name: "Palmer", zone: "Antarctica/Palmer" },
      { name: "Rothera", zone: "Antarctica/Rothera" },
      { name: "Stanley", zone: "Atlantic/Stanley" },
    ],
  },
  {
    zone: "America/Noronha",
    cities: [
      { name: "Noronha", zone: "America/Noronha" },
      { name: "South Georgia", zone: "Atlantic/South_Georgia" },
    ],
  },
  {
    zone: "America/Nuuk",
    cities: [
      { name: "Nuuk", zone: "America/Nuuk" },
      { name: "Scoresbysund", zone: "America/Scoresbysund" },
    ],
  },
  {
    zone: "Atlantic/Azores",
    cities: [
      { name: "Azores", zone: "Atlantic/Azores" },
    ],
  },
  {
    zone: "Atlantic/Cape_Verde",
    cities: [
      { name: "Cape Verde", zone: "Atlantic/Cape_Verde" },
    ],
  },
  {
    zone: "Antarctica/Troll",
    cities: [
      { name: "Troll", zone: "Antarctica/Troll" },
    ],
  },
  {
    zone: "Atlantic/Reykjavik",
    cities: [
      { name: "Reykjavik", zone: "Atlantic/Reykjavik" },
      { name: "Accra", zone: "Africa/Accra" },
      { name: "Abidjan", zone: "Africa/Abidjan" },
      { name: "Dakar", zone: "Africa/Dakar" },
      { name: "Bamako", zone: "Africa/Bamako" },
      { name: "Banjul", zone: "Africa/Banjul" },
      { name: "Bissau", zone: "Africa/Bissau" },
      { name: "Conakry", zone: "Africa/Conakry" },
      { name: "Freetown", zone: "Africa/Freetown" },
      { name: "Lome", zone: "Africa/Lome" },
      { name: "Monrovia", zone: "Africa/Monrovia" },
      { name: "Nouakchott", zone: "Africa/Nouakchott" },
      { name: "Ouagadougou", zone: "Africa/Ouagadougou" },
      { name: "Sao Tome", zone: "Africa/Sao_Tome" },
      { name: "Danmarkshavn", zone: "America/Danmarkshavn" },
      { name: "St Helena", zone: "Atlantic/St_Helena" },
    ],
  },
  {
    zone: "Europe/London",
    cities: [
      { name: "London", zone: "Europe/London" },
      { name: "Dublin", zone: "Europe/Dublin" },
      { name: "Lisbon", zone: "Europe/Lisbon" },
      { name: "Canary", zone: "Atlantic/Canary" },
      { name: "Madeira", zone: "Atlantic/Madeira" },
      { name: "Faroe", zone: "Atlantic/Faroe" },
      { name: "Guernsey", zone: "Europe/Guernsey" },
      { name: "Isle of Man", zone: "Europe/Isle_of_Man" },
      { name: "Jersey", zone: "Europe/Jersey" },
    ],
  },
  {
    zone: "Africa/Algiers",
    cities: [
      { name: "Algiers", zone: "Africa/Algiers" },
      { name: "Tunis", zone: "Africa/Tunis" },
      { name: "Lagos", zone: "Africa/Lagos" },
      { name: "Kinshasa", zone: "Africa/Kinshasa" },
      { name: "Luanda", zone: "Africa/Luanda" },
      { name: "Bangui", zone: "Africa/Bangui" },
      { name: "Brazzaville", zone: "Africa/Brazzaville" },
      { name: "Douala", zone: "Africa/Douala" },
      { name: "Libreville", zone: "Africa/Libreville" },
      { name: "Malabo", zone: "Africa/Malabo" },
      { name: "Ndjamena", zone: "Africa/Ndjamena" },
      { name: "Niamey", zone: "Africa/Niamey" },
      { name: "Porto-Novo", zone: "Africa/Porto-Novo" },
    ],
  },
  {
    zone: "Africa/Casablanca",
    cities: [
      { name: "Casablanca", zone: "Africa/Casablanca" },
      { name: "El Aaiun", zone: "Africa/El_Aaiun" },
    ],
  },
  {
    zone: "Europe/Paris",
    cities: [
      { name: "Paris", zone: "Europe/Paris" },
      { name: "Madrid", zone: "Europe/Madrid" },
      { name: "Berlin", zone: "Europe/Berlin" },
      { name: "Rome", zone: "Europe/Rome" },
      { name: "Amsterdam", zone: "Europe/Amsterdam" },
      { name: "Brussels", zone: "Europe/Brussels" },
      { name: "Vienna", zone: "Europe/Vienna" },
      { name: "Zurich", zone: "Europe/Zurich" },
      { name: "Prague", zone: "Europe/Prague" },
      { name: "Warsaw", zone: "Europe/Warsaw" },
      { name: "Stockholm", zone: "Europe/Stockholm" },
      { name: "Oslo", zone: "Europe/Oslo" },
      { name: "Copenhagen", zone: "Europe/Copenhagen" },
      { name: "Budapest", zone: "Europe/Budapest" },
      { name: "Belgrade", zone: "Europe/Belgrade" },
      { name: "Bratislava", zone: "Europe/Bratislava" },
      { name: "Ljubljana", zone: "Europe/Ljubljana" },
      { name: "Sarajevo", zone: "Europe/Sarajevo" },
      { name: "Zagreb", zone: "Europe/Zagreb" },
      { name: "Skopje", zone: "Europe/Skopje" },
      { name: "Tirane", zone: "Europe/Tirane" },
      { name: "Malta", zone: "Europe/Malta" },
      { name: "Luxembourg", zone: "Europe/Luxembourg" },
      { name: "Monaco", zone: "Europe/Monaco" },
      { name: "Andorra", zone: "Europe/Andorra" },
      { name: "Gibraltar", zone: "Europe/Gibraltar" },
      { name: "Ceuta", zone: "Africa/Ceuta" },
      { name: "Longyearbyen", zone: "Arctic/Longyearbyen" },
      { name: "Busingen", zone: "Europe/Busingen" },
      { name: "Podgorica", zone: "Europe/Podgorica" },
      { name: "San Marino", zone: "Europe/San_Marino" },
      { name: "Vaduz", zone: "Europe/Vaduz" },
      { name: "Vatican", zone: "Europe/Vatican" },
    ],
  },
  {
    zone: "Africa/Cairo",
    cities: [
      { name: "Cairo", zone: "Africa/Cairo" },
    ],
  },
  {
    zone: "Africa/Tripoli",
    cities: [
      { name: "Tripoli", zone: "Africa/Tripoli" },
      { name: "Khartoum", zone: "Africa/Khartoum" },
      { name: "Kigali", zone: "Africa/Kigali" },
      { name: "Johannesburg", zone: "Africa/Johannesburg" },
      { name: "Windhoek", zone: "Africa/Windhoek" },
      { name: "Harare", zone: "Africa/Harare" },
      { name: "Maputo", zone: "Africa/Maputo" },
      { name: "Kaliningrad", zone: "Europe/Kaliningrad" },
      { name: "Blantyre", zone: "Africa/Blantyre" },
      { name: "Bujumbura", zone: "Africa/Bujumbura" },
      { name: "Gaborone", zone: "Africa/Gaborone" },
      { name: "Juba", zone: "Africa/Juba" },
      { name: "Lubumbashi", zone: "Africa/Lubumbashi" },
      { name: "Lusaka", zone: "Africa/Lusaka" },
      { name: "Maseru", zone: "Africa/Maseru" },
      { name: "Mbabane", zone: "Africa/Mbabane" },
    ],
  },
  {
    zone: "Asia/Gaza",
    cities: [
      { name: "Gaza", zone: "Asia/Gaza" },
      { name: "Hebron", zone: "Asia/Hebron" },
    ],
  },
  {
    zone: "Asia/Jerusalem",
    cities: [
      { name: "Jerusalem", zone: "Asia/Jerusalem" },
    ],
  },
  {
    zone: "Europe/Kyiv",
    cities: [
      { name: "Kyiv", zone: "Europe/Kyiv" },
      { name: "Helsinki", zone: "Europe/Helsinki" },
      { name: "Athens", zone: "Europe/Athens" },
      { name: "Nicosia", zone: "Asia/Nicosia" },
      { name: "Riga", zone: "Europe/Riga" },
      { name: "Vilnius", zone: "Europe/Vilnius" },
      { name: "Tallinn", zone: "Europe/Tallinn" },
      { name: "Sofia", zone: "Europe/Sofia" },
      { name: "Bucharest", zone: "Europe/Bucharest" },
      { name: "Chisinau", zone: "Europe/Chisinau" },
      { name: "Beirut", zone: "Asia/Beirut" },
      { name: "Famagusta", zone: "Asia/Famagusta" },
      { name: "Mariehamn", zone: "Europe/Mariehamn" },
    ],
  },
  {
    zone: "Europe/Minsk",
    cities: [
      { name: "Minsk", zone: "Europe/Minsk" },
      { name: "Moscow", zone: "Europe/Moscow" },
      { name: "Istanbul", zone: "Europe/Istanbul" },
      { name: "Damascus", zone: "Asia/Damascus" },
      { name: "Amman", zone: "Asia/Amman" },
      { name: "Baghdad", zone: "Asia/Baghdad" },
      { name: "Riyadh", zone: "Asia/Riyadh" },
      { name: "Kuwait", zone: "Asia/Kuwait" },
      { name: "Addis Ababa", zone: "Africa/Addis_Ababa" },
      { name: "Nairobi", zone: "Africa/Nairobi" },
      { name: "Dar es Salaam", zone: "Africa/Dar_es_Salaam" },
      { name: "Kampala", zone: "Africa/Kampala" },
      { name: "Antananarivo", zone: "Indian/Antananarivo" },
      { name: "Volgograd", zone: "Europe/Volgograd" },
      { name: "Asmara", zone: "Africa/Asmara" },
      { name: "Djibouti", zone: "Africa/Djibouti" },
      { name: "Mogadishu", zone: "Africa/Mogadishu" },
      { name: "Syowa", zone: "Antarctica/Syowa" },
      { name: "Aden", zone: "Asia/Aden" },
      { name: "Bahrain", zone: "Asia/Bahrain" },
      { name: "Qatar", zone: "Asia/Qatar" },
      { name: "Kirov", zone: "Europe/Kirov" },
      { name: "Simferopol", zone: "Europe/Simferopol" },
      { name: "Comoro", zone: "Indian/Comoro" },
      { name: "Mayotte", zone: "Indian/Mayotte" },
    ],
  },
  {
    zone: "Asia/Tehran",
    cities: [
      { name: "Tehran", zone: "Asia/Tehran" },
    ],
  },
  {
    zone: "Asia/Dubai",
    cities: [
      { name: "Dubai", zone: "Asia/Dubai" },
      { name: "Muscat", zone: "Asia/Muscat" },
      { name: "Baku", zone: "Asia/Baku" },
      { name: "Tbilisi", zone: "Asia/Tbilisi" },
      { name: "Yerevan", zone: "Asia/Yerevan" },
      { name: "Samara", zone: "Europe/Samara" },
      { name: "Astrakhan", zone: "Europe/Astrakhan" },
      { name: "Saratov", zone: "Europe/Saratov" },
      { name: "Ulyanovsk", zone: "Europe/Ulyanovsk" },
      { name: "Mahe", zone: "Indian/Mahe" },
      { name: "Mauritius", zone: "Indian/Mauritius" },
      { name: "Reunion", zone: "Indian/Reunion" },
    ],
  },
  {
    zone: "Asia/Kabul",
    cities: [
      { name: "Kabul", zone: "Asia/Kabul" },
    ],
  },
  {
    zone: "Asia/Karachi",
    cities: [
      { name: "Karachi", zone: "Asia/Karachi" },
      { name: "Tashkent", zone: "Asia/Tashkent" },
      { name: "Almaty", zone: "Asia/Almaty" },
      { name: "Dushanbe", zone: "Asia/Dushanbe" },
      { name: "Ashgabat", zone: "Asia/Ashgabat" },
      { name: "Yekaterinburg", zone: "Asia/Yekaterinburg" },
      { name: "Mawson", zone: "Antarctica/Mawson" },
      { name: "Vostok", zone: "Antarctica/Vostok" },
      { name: "Aqtau", zone: "Asia/Aqtau" },
      { name: "Aqtobe", zone: "Asia/Aqtobe" },
      { name: "Atyrau", zone: "Asia/Atyrau" },
      { name: "Oral", zone: "Asia/Oral" },
      { name: "Qostanay", zone: "Asia/Qostanay" },
      { name: "Qyzylorda", zone: "Asia/Qyzylorda" },
      { name: "Samarkand", zone: "Asia/Samarkand" },
      { name: "Kerguelen", zone: "Indian/Kerguelen" },
      { name: "Maldives", zone: "Indian/Maldives" },
    ],
  },
  {
    zone: "Asia/Kolkata",
    cities: [
      { name: "Kolkata", zone: "Asia/Kolkata" },
      { name: "Colombo", zone: "Asia/Colombo" },
    ],
  },
  {
    zone: "Asia/Kathmandu",
    cities: [
      { name: "Kathmandu", zone: "Asia/Kathmandu" },
    ],
  },
  {
    zone: "Asia/Bishkek",
    cities: [
      { name: "Bishkek", zone: "Asia/Bishkek" },
      { name: "Dhaka", zone: "Asia/Dhaka" },
      { name: "Thimphu", zone: "Asia/Thimphu" },
      { name: "Omsk", zone: "Asia/Omsk" },
      { name: "Urumqi", zone: "Asia/Urumqi" },
      { name: "Chagos", zone: "Indian/Chagos" },
    ],
  },
  {
    zone: "Asia/Yangon",
    cities: [
      { name: "Yangon", zone: "Asia/Yangon" },
      { name: "Cocos", zone: "Indian/Cocos" },
    ],
  },
  {
    zone: "Asia/Bangkok",
    cities: [
      { name: "Bangkok", zone: "Asia/Bangkok" },
      { name: "Vientiane", zone: "Asia/Vientiane" },
      { name: "Phnom Penh", zone: "Asia/Phnom_Penh" },
      { name: "Ho Chi Minh", zone: "Asia/Ho_Chi_Minh" },
      { name: "Jakarta", zone: "Asia/Jakarta" },
      { name: "Novosibirsk", zone: "Asia/Novosibirsk" },
      { name: "Krasnoyarsk", zone: "Asia/Krasnoyarsk" },
      { name: "Davis", zone: "Antarctica/Davis" },
      { name: "Barnaul", zone: "Asia/Barnaul" },
      { name: "Hovd", zone: "Asia/Hovd" },
      { name: "Novokuznetsk", zone: "Asia/Novokuznetsk" },
      { name: "Pontianak", zone: "Asia/Pontianak" },
      { name: "Tomsk", zone: "Asia/Tomsk" },
      { name: "Christmas", zone: "Indian/Christmas" },
    ],
  },
  {
    zone: "Asia/Kuala_Lumpur",
    cities: [
      { name: "Kuala Lumpur", zone: "Asia/Kuala_Lumpur" },
      { name: "Singapore", zone: "Asia/Singapore" },
      { name: "Brunei", zone: "Asia/Brunei" },
      { name: "Manila", zone: "Asia/Manila" },
      { name: "Hong Kong", zone: "Asia/Hong_Kong" },
      { name: "Macau", zone: "Asia/Macau" },
      { name: "Taipei", zone: "Asia/Taipei" },
      { name: "Shanghai", zone: "Asia/Shanghai" },
      { name: "Ulaanbaatar", zone: "Asia/Ulaanbaatar" },
      { name: "Perth", zone: "Australia/Perth" },
      { name: "Irkutsk", zone: "Asia/Irkutsk" },
      { name: "Casey", zone: "Antarctica/Casey" },
      { name: "Kuching", zone: "Asia/Kuching" },
      { name: "Makassar", zone: "Asia/Makassar" },
    ],
  },
  {
    zone: "Australia/Eucla",
    cities: [
      { name: "Eucla", zone: "Australia/Eucla" },
    ],
  },
  {
    zone: "Asia/Seoul",
    cities: [
      { name: "Seoul", zone: "Asia/Seoul" },
      { name: "Pyongyang", zone: "Asia/Pyongyang" },
      { name: "Tokyo", zone: "Asia/Tokyo" },
      { name: "Yakutsk", zone: "Asia/Yakutsk" },
      { name: "Chita", zone: "Asia/Chita" },
      { name: "Dili", zone: "Asia/Dili" },
      { name: "Jayapura", zone: "Asia/Jayapura" },
      { name: "Khandyga", zone: "Asia/Khandyga" },
      { name: "Palau", zone: "Pacific/Palau" },
    ],
  },
  {
    zone: "Australia/Darwin",
    cities: [
      { name: "Darwin", zone: "Australia/Darwin" },
    ],
  },
  {
    zone: "Australia/Brisbane",
    cities: [
      { name: "Brisbane", zone: "Australia/Brisbane" },
      { name: "Port Moresby", zone: "Pacific/Port_Moresby" },
      { name: "Vladivostok", zone: "Asia/Vladivostok" },
      { name: "DumontDUrville", zone: "Antarctica/DumontDUrville" },
      { name: "Ust-Nera", zone: "Asia/Ust-Nera" },
      { name: "Lindeman", zone: "Australia/Lindeman" },
      { name: "Chuuk", zone: "Pacific/Chuuk" },
      { name: "Guam", zone: "Pacific/Guam" },
      { name: "Saipan", zone: "Pacific/Saipan" },
    ],
  },
  {
    zone: "Australia/Adelaide",
    cities: [
      { name: "Adelaide", zone: "Australia/Adelaide" },
      { name: "Broken Hill", zone: "Australia/Broken_Hill" },
    ],
  },
  {
    zone: "Australia/Lord_Howe",
    cities: [
      { name: "Lord Howe", zone: "Australia/Lord_Howe" },
    ],
  },
  {
    zone: "Australia/Sydney",
    cities: [
      { name: "Sydney", zone: "Australia/Sydney" },
      { name: "Melbourne", zone: "Australia/Melbourne" },
      { name: "Macquarie", zone: "Antarctica/Macquarie" },
      { name: "Hobart", zone: "Australia/Hobart" },
    ],
  },
  {
    zone: "Pacific/Noumea",
    cities: [
      { name: "Noumea", zone: "Pacific/Noumea" },
      { name: "Magadan", zone: "Asia/Magadan" },
      { name: "Sakhalin", zone: "Asia/Sakhalin" },
      { name: "Srednekolymsk", zone: "Asia/Srednekolymsk" },
      { name: "Bougainville", zone: "Pacific/Bougainville" },
      { name: "Efate", zone: "Pacific/Efate" },
      { name: "Guadalcanal", zone: "Pacific/Guadalcanal" },
      { name: "Kosrae", zone: "Pacific/Kosrae" },
      { name: "Pohnpei", zone: "Pacific/Pohnpei" },
    ],
  },
  {
    zone: "Pacific/Fiji",
    cities: [
      { name: "Fiji", zone: "Pacific/Fiji" },
      { name: "Kamchatka", zone: "Asia/Kamchatka" },
      { name: "Anadyr", zone: "Asia/Anadyr" },
      { name: "Funafuti", zone: "Pacific/Funafuti" },
      { name: "Kwajalein", zone: "Pacific/Kwajalein" },
      { name: "Majuro", zone: "Pacific/Majuro" },
      { name: "Nauru", zone: "Pacific/Nauru" },
      { name: "Tarawa", zone: "Pacific/Tarawa" },
      { name: "Wake", zone: "Pacific/Wake" },
      { name: "Wallis", zone: "Pacific/Wallis" },
    ],
  },
  {
    zone: "Pacific/Norfolk",
    cities: [
      { name: "Norfolk", zone: "Pacific/Norfolk" },
    ],
  },
  {
    zone: "Pacific/Apia",
    cities: [
      { name: "Apia", zone: "Pacific/Apia" },
      { name: "Fakaofo", zone: "Pacific/Fakaofo" },
      { name: "Kanton", zone: "Pacific/Kanton" },
      { name: "Tongatapu", zone: "Pacific/Tongatapu" },
    ],
  },
  {
    zone: "Pacific/Auckland",
    cities: [
      { name: "Auckland", zone: "Pacific/Auckland" },
      { name: "McMurdo", zone: "Antarctica/McMurdo" },
    ],
  },
  {
    zone: "Pacific/Chatham",
    cities: [
      { name: "Chatham", zone: "Pacific/Chatham" },
    ],
  },
  {
    zone: "Pacific/Kiritimati",
    cities: [
      { name: "Kiritimati", zone: "Pacific/Kiritimati" },
    ],
  },
];

/** Представители групп — плоско. */
export const TIMEZONE_OPTIONS: string[] = ZONE_GROUPS.map((g) => g.zone);
