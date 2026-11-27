(function () {
  'use strict';

  const DAY_START = 9 * 60;      // 09:00 (540)
  const EVENING_START = 18 * 60; // 18:00 (1080) - 이후 광개토관 1~4층만 공식 개방
  const DAY_END = 22 * 60;       // 22:00 (1320)
  const TOTAL_DAY_MIN = DAY_END - DAY_START; // 780 min (13h)

  const DAY_NAMES = {
    '월': '월요일',
    '화': '화요일',
    '수': '수요일',
    '목': '목요일',
    '금': '금요일'
  };

  const DATA = window.SCHEDULE_DATA;
  if (!DATA || !Array.isArray(DATA.rooms)) {
    console.error('SCHEDULE_DATA is missing.');
    return;
  }

  // DOM Elements
  const selectDay = document.getElementById('selectDay');
  const selectTime = document.getElementById('selectTime');
  const selectBuilding = document.getElementById('selectBuilding');
  const selectMinHours = document.getElementById('selectMinHours');
  const summaryCount = document.getElementById('summaryCount');
  const summaryDesc = document.getElementById('summaryDesc');
  const roomGrid = document.getElementById('roomGrid');
  const emptyState = document.getElementById('emptyState');
  const emptyTitle = document.getElementById('emptyTitle');
  const emptySub = document.getElementById('emptySub');
  const btnSwitchGwang = document.getElementById('btnSwitchGwang');
  const eveningBanner = document.getElementById('eveningBanner');
  const btnNow = document.getElementById('btnNow');
  const countAllFloor = document.getElementById('countAllFloor');
  const countLowFloor = document.getElementById('countLowFloor');
  const countHighFloor = document.getElementById('countHighFloor');
  const countFav = document.getElementById('countFav');
  const floorChipBtns = document.querySelectorAll('.filter-chip[data-floor]');
  const sortBtns = document.querySelectorAll('.sort-btn[data-sort]');

  // State: Floor filter, Sort mode, Favorites
  const FAV_STORAGE_KEY = 'sejong_empty_rooms_favs_v1';
  let floorFilter = 'all'; // 'all' | 'low' (<=3F incl. B) | 'high' (>=4F) | 'fav'
  let sortMode = 'id';     // 'id' | 'duration'
  let favorites = new Set();

  try {
    const saved = JSON.parse(localStorage.getItem(FAV_STORAGE_KEY) || '[]');
    if (Array.isArray(saved)) favorites = new Set(saved);
  } catch (_) {}

  function saveFavorites() {
    try {
      localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(Array.from(favorites)));
    } catch (_) {}
  }

  function getRoomFloor(roomId) {
    // Basement: 센B105, 센B205, 충B107, 율B104A -> negative floor (-1, -2) => treated as low floor (<=3)
    const mB = roomId.match(/B(\d)/i);
    if (mB) return -parseInt(mB[1], 10);
    // 4-digit room number: 충1007 -> 10, 충1108 -> 11
    const m4 = roomId.match(/(\d{4})/);
    if (m4) return parseInt(m4[1].slice(0, 2), 10);
    // 3-digit room number: 광102 -> 1, 광313 -> 3, 광413 -> 4, 집702 -> 7
    const m3 = roomId.match(/(\d{3})/);
    if (m3) return parseInt(m3[1].slice(0, 1), 10);
    return 1;
  }

  function isLowFloor(roomId) {
    return getRoomFloor(roomId) <= 3;
  }

  // Room Modal DOM
  const roomModalBackdrop = document.getElementById('roomModalBackdrop');
  const btnCloseRoomModal = document.getElementById('btnCloseRoomModal');
  const modalRoomTitle = document.getElementById('modalRoomTitle');
  const modalRoomSub = document.getElementById('modalRoomSub');
  const modalStatusBox = document.getElementById('modalStatusBox');
  const modalTimelineBar = document.getElementById('modalTimelineBar');
  const modalClassListLabel = document.getElementById('modalClassListLabel');
  const modalClassList = document.getElementById('modalClassList');
  const modalReportActions = document.getElementById('modalReportActions');
  const btnClearReport = document.getElementById('btnClearReport');
  const modalReportNote = document.getElementById('modalReportNote');

  // Room status reports (persisted in localStorage per room+day)
  const REPORT_STORAGE_KEY = 'sejong_empty_rooms_reports_v1';
  let roomReports = {};
  let activeModalContext = null;

  try {
    const savedRep = JSON.parse(localStorage.getItem(REPORT_STORAGE_KEY) || '{}');
    if (savedRep && typeof savedRep === 'object') roomReports = savedRep;
  } catch (_) {}

  function saveReports() {
    try {
      localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(roomReports));
    } catch (_) {}
  }

  function getReportKey(roomId, day) {
    return `${roomId}::${day}`;
  }

  function getRoomReport(roomId, day) {
    return roomReports[getReportKey(roomId, day)] || null;
  }

  // PPT Phase 1 proposal: Exam-period weekday 18:00~22:00 Gwanggaeto 1~4F official opening
  function isOfficialExamOpen(room, timeMin) {
    return room.building === '광개토관' && timeMin >= 18 * 60;
  }

  // Near My Class DOM
  const btnOpenNearby = document.getElementById('btnOpenNearby');
  const nearbyModalBackdrop = document.getElementById('nearbyModalBackdrop');
  const btnCloseNearbyModal = document.getElementById('btnCloseNearbyModal');
  const nearbySearchInput = document.getElementById('nearbySearchInput');
  const nearbyResults = document.getElementById('nearbyResults');
  const anchorBanner = document.getElementById('anchorBanner');
  const anchorBannerText = document.getElementById('anchorBannerText');
  const btnClearAnchor = document.getElementById('btnClearAnchor');

  // Sejong Univ campus walking time (minutes) between the 5 buildings
  const WALK_MINUTES = {
    '광개토관':   { '광개토관': 0, '군자관': 2, '집현관': 2, '대양AI센터': 3, '충무관': 4 },
    '대양AI센터': { '대양AI센터': 0, '충무관': 2, '광개토관': 3, '군자관': 3, '집현관': 4 },
    '집현관':     { '집현관': 0, '광개토관': 2, '군자관': 2, '대양AI센터': 4, '충무관': 5 },
    '충무관':     { '충무관': 0, '대양AI센터': 2, '광개토관': 4, '군자관': 4, '집현관': 5 },
    '군자관':     { '군자관': 0, '광개토관': 2, '집현관': 2, '대양AI센터': 3, '충무관': 4 }
  };

  let anchorClass = null; // { roomId, building, floor, title, day, start, end }

  function getProximityScore(anchor, room) {
    const walk = (WALK_MINUTES[anchor.building] && WALK_MINUTES[anchor.building][room.building] !== undefined)
      ? WALK_MINUTES[anchor.building][room.building]
      : 5;
    if (walk === 0) {
      const floorDiff = Math.abs(anchor.floor - getRoomFloor(room.id));
      const label = room.id === anchor.roomId
        ? '같은 강의실'
        : floorDiff === 0
          ? '같은 건물 · 같은 층'
          : `같은 건물 · ${floorDiff}층 차이`;
      return { score: floorDiff, label };
    }
    return { score: 100 + walk * 10 + Math.abs(getRoomFloor(room.id)), label: `도보 약 ${walk}분` };
  }

  // Build flat searchable course index from SCHEDULE_DATA
  const COURSE_INDEX = [];
  (function buildCourseIndex() {
    const days = ['월', '화', '수', '목', '금'];
    for (let i = 0; i < DATA.rooms.length; i++) {
      const rm = DATA.rooms[i];
      for (let dIdx = 0; dIdx < days.length; dIdx++) {
        const d = days[dIdx];
        const list = (rm.schedule && rm.schedule[d]) || [];
        for (let j = 0; j < list.length; j++) {
          const c = list[j];
          COURSE_INDEX.push({
            roomId: rm.id,
            building: rm.building,
            floor: getRoomFloor(rm.id),
            day: d,
            start: c.s,
            end: c.e,
            title: c.t,
            prof: c.p || '',
            searchKey: `${c.t} ${c.p || ''} ${rm.id} ${rm.building}`.toLowerCase()
          });
        }
      }
    }
  })();

  // AI Drawer DOM
  const btnOpenAi = document.getElementById('btnOpenAi');
  const aiModalBackdrop = document.getElementById('aiModalBackdrop');
  const btnCloseAiModal = document.getElementById('btnCloseAiModal');
  const aiMessages = document.getElementById('aiMessages');
  const aiForm = document.getElementById('aiForm');
  const aiInput = document.getElementById('aiInput');

  // --- Time Formatting Helpers ---
  function formatMin(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function formatDuration(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0 && m > 0) return `${h}시간 ${m}분`;
    if (h > 0) return `${h}시간`;
    return `${m}분`;
  }

  function minLabel(mins) {
    return `${formatDuration(mins)} 이상`;
  }

  function getNowDefaults() {
    const now = new Date();
    const jsDay = now.getDay(); // 0 Sun, 1 Mon ... 5 Fri, 6 Sat
    const dayMap = { 1: '월', 2: '화', 3: '수', 4: '목', 5: '금' };
    const totalMin = now.getHours() * 60 + now.getMinutes();

    if (dayMap[jsDay] && totalMin >= DAY_START && totalMin <= DAY_END - 30) {
      const snapped = Math.floor(totalMin / 30) * 30;
      return {
        day: dayMap[jsDay],
        timeMin: Math.max(DAY_START, Math.min(DAY_END - 30, snapped)),
        isLive: true
      };
    }
    return { day: '목', timeMin: 18 * 60, isLive: false };
  }

  // --- Core Tool Function: find_empty_rooms ---
  function getRoomFreeUntil(room, day, queryMin) {
    // 18:00 이후에는 공식 개방 건물인 광개토관(1~4층)만 이용 가능
    if (queryMin >= EVENING_START && room.building !== '광개토관') {
      return null;
    }
    const classes = (room.schedule && room.schedule[day]) || [];
    let nextStart = room.building === '광개토관' ? DAY_END : EVENING_START;
    for (let i = 0; i < classes.length; i++) {
      const c = classes[i];
      if (c.s <= queryMin && queryMin < c.e) {
        return null; // occupied right now
      }
      if (c.s > queryMin && c.s < nextStart) {
        nextStart = c.s;
      }
    }
    return nextStart;
  }

  function find_empty_rooms({ day, timeMin, building = '전체', minMinutes = 30, floor = 'all' }) {
    const results = [];
    for (let i = 0; i < DATA.rooms.length; i++) {
      const room = DATA.rooms[i];
      if (building !== '전체' && room.building !== building) continue;
      if (floor === 'low' && !isLowFloor(room.id)) continue;
      if (floor === 'high' && isLowFloor(room.id)) continue;
      if (floor === 'fav' && !favorites.has(room.id)) continue;
      const freeUntil = getRoomFreeUntil(room, day, timeMin);
      if (freeUntil === null) continue;
      const freeMinutes = freeUntil - timeMin;
      if (freeMinutes >= minMinutes) {
        results.push({
          room,
          freeUntil,
          freeMinutes
        });
      }
    }
    // Sort by room id (natural order matching PPT screenshot)
    results.sort((a, b) => a.room.id.localeCompare(b.room.id, 'ko', { numeric: true }));
    return results;
  }

  // Expose for debugging/testing
  window.find_empty_rooms = find_empty_rooms;

  // --- Populate Time Dropdown (09:00 ~ 21:30, 30-min steps) ---
  function initTimeOptions() {
    const frag = document.createDocumentFragment();
    for (let m = DAY_START; m <= DAY_END - 30; m += 30) {
      const opt = document.createElement('option');
      opt.value = String(m);
      opt.textContent = formatMin(m);
      frag.appendChild(opt);
    }
    selectTime.appendChild(frag);
  }

  // --- Render Main View ---
  function render() {
    const day = selectDay.value;
    const timeMin = parseInt(selectTime.value, 10);
    const building = selectBuilding.value;
    const minMinutes = parseInt(selectMinHours.value, 10);

    // Base results before floor/fav filter (for live badge counts)
    const baseResults = find_empty_rooms({ day, timeMin, building, minMinutes, floor: 'all' });
    const lowCount = baseResults.filter((r) => isLowFloor(r.room.id)).length;
    const highCount = baseResults.length - lowCount;
    const favCount = baseResults.filter((r) => favorites.has(r.room.id)).length;

    if (countAllFloor) countAllFloor.textContent = String(baseResults.length);
    if (countLowFloor) countLowFloor.textContent = String(lowCount);
    if (countHighFloor) countHighFloor.textContent = String(highCount);
    if (countFav) countFav.textContent = String(favCount);

    let results = baseResults;
    if (floorFilter === 'low') results = baseResults.filter((r) => isLowFloor(r.room.id));
    else if (floorFilter === 'high') results = baseResults.filter((r) => !isLowFloor(r.room.id));
    else if (floorFilter === 'fav') results = baseResults.filter((r) => favorites.has(r.room.id));

    if (anchorClass) {
      results = [...results].sort((a, b) => {
        const pa = getProximityScore(anchorClass, a.room).score;
        const pb = getProximityScore(anchorClass, b.room).score;
        if (pa !== pb) return pa - pb;
        if (sortMode === 'duration') return b.freeMinutes - a.freeMinutes;
        return a.room.id.localeCompare(b.room.id, 'ko', { numeric: true });
      });
      if (anchorBanner && anchorBannerText) {
        anchorBanner.classList.remove('hidden');
        anchorBannerText.innerHTML = `📍 <strong>${escapeHtml(anchorClass.roomId)} (${escapeHtml(anchorClass.title)})</strong> 기준 가까운 순으로 정렬 중`;
      }
    } else {
      if (anchorBanner) anchorBanner.classList.add('hidden');
      if (sortMode === 'duration') {
        results = [...results].sort((a, b) =>
          b.freeMinutes - a.freeMinutes || a.room.id.localeCompare(b.room.id, 'ko', { numeric: true })
        );
      }
    }

    const isEvening = timeMin >= EVENING_START;
    const isBlockedBuilding = isEvening && building !== '전체' && building !== '광개토관';

    if (eveningBanner) {
      if (isEvening) {
        eveningBanner.classList.remove('hidden');
        if (isBlockedBuilding) {
          eveningBanner.classList.add('is-blocked');
          eveningBanner.innerHTML = `🔒 <strong>18:00 이후</strong>에는 <strong>${escapeHtml(building)}</strong> 강의실을 사용할 수 없습니다. 공식 개방인 <strong>광개토관 1~4층</strong>만 이용 가능합니다.`;
        } else {
          eveningBanner.classList.remove('is-blocked');
          eveningBanner.innerHTML = `🌙 <strong>18:00 이후 저녁 시간대</strong>에는 공식 개방 건물인 <strong>광개토관 1~4층</strong>만 이용할 수 있습니다. (타 건물 이용 불가)`;
        }
      } else {
        eveningBanner.classList.add('hidden');
        eveningBanner.classList.remove('is-blocked');
      }
    }

    summaryCount.textContent = `${results.length}실`;
    const buildingText =
      building === '전체'
        ? (isEvening ? '광개토관 1~4층 (18시 이후 공식 개방)' : '주요 5개 건물 전체')
        : building;
    const floorSuffix =
      floorFilter === 'low' ? ' · 3층 이하' :
      floorFilter === 'high' ? ' · 4층 이상' :
      floorFilter === 'fav' ? ' · 즐겨찾기' : '';
    summaryDesc.textContent = `${DAY_NAMES[day]} ${formatMin(timeMin)} 기준, ${minLabel(minMinutes)} 비어 있는 강의실 · ${buildingText}${floorSuffix}`;

    roomGrid.innerHTML = '';

    if (results.length === 0) {
      roomGrid.classList.add('hidden');
      emptyState.classList.remove('hidden');
      if (isBlockedBuilding) {
        if (emptyTitle) emptyTitle.textContent = `18:00 이후에는 ${building} 강의실을 사용할 수 없습니다.`;
        if (emptySub) emptySub.textContent = '저녁 18:00~22:00 공식 개방은 광개토관 1~4층만 운영됩니다.';
        if (btnSwitchGwang) btnSwitchGwang.classList.remove('hidden');
      } else {
        if (emptyTitle) emptyTitle.textContent = '조건에 맞는 빈 강의실이 없습니다.';
        if (emptySub) emptySub.textContent = '최소 비어 있는 시간을 줄이거나 다른 건물을 선택해 보세요.';
        if (btnSwitchGwang) btnSwitchGwang.classList.add('hidden');
      }
      return;
    }

    roomGrid.classList.remove('hidden');
    emptyState.classList.add('hidden');
    if (btnSwitchGwang) btnSwitchGwang.classList.add('hidden');

    const frag = document.createDocumentFragment();
    for (let i = 0; i < results.length; i++) {
      const { room, freeUntil, freeMinutes } = results[i];
      const pct = Math.max(4, Math.min(100, (freeMinutes / TOTAL_DAY_MIN) * 100));
      const isFav = favorites.has(room.id);

      const badges = [];
      if (isOfficialExamOpen(room, timeMin)) {
        badges.push('<span class="badge--official">시험기간 공식 개방</span>');
      }
      if (anchorClass) {
        badges.push(`<span class="room-prox-badge">${escapeHtml(getProximityScore(anchorClass, room).label)}</span>`);
      }
      const rep = getRoomReport(room.id, day);
      if (rep) {
        if (rep.type === 'locked') badges.push('<span class="badge--locked">🔒 문 잠김 제보</span>');
        else badges.push('<span class="badge--warn">⚠️ 수업·시험 제보</span>');
      }
      const badgesHtml = badges.length > 0 ? `<div class="room-badges">${badges.join('')}</div>` : '';

      const card = document.createElement('div');
      card.className = 'room-card' + (rep ? ' is-reported' : '');
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');

      card.innerHTML = `
        <div class="room-card-head">
          <div>
            <div class="room-id">${escapeHtml(room.id)}</div>
            <div class="room-building">${escapeHtml(room.building)}</div>
          </div>
          <button type="button" class="room-fav-btn ${isFav ? 'is-fav' : ''}" aria-label="${escapeHtml(room.id)} 즐겨찾기" title="즐겨찾기">${isFav ? '★' : '☆'}</button>
        </div>
        ${badgesHtml}
        <span class="room-free-text">${formatMin(freeUntil)}까지 비어 있음 (${formatDuration(freeMinutes)})</span>
        <div class="room-progress" aria-hidden="true">
          <div class="room-progress-fill" style="width: ${pct.toFixed(1)}%"></div>
        </div>
      `;

      const favBtn = card.querySelector('.room-fav-btn');
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (favorites.has(room.id)) favorites.delete(room.id);
        else favorites.add(room.id);
        saveFavorites();
        render();
      });

      card.addEventListener('click', () => openRoomModal(room, day, timeMin, freeUntil, freeMinutes));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openRoomModal(room, day, timeMin, freeUntil, freeMinutes);
        }
      });
      frag.appendChild(card);
    }
    roomGrid.appendChild(frag);
  }

  // --- Room Detail Modal ---
  function syncModalReportUI() {
    if (!activeModalContext || !modalReportActions) return;
    const { room, day } = activeModalContext;
    const rep = getRoomReport(room.id, day);
    modalReportActions.querySelectorAll('.report-btn[data-report]').forEach((btn) => {
      btn.classList.toggle('is-active', Boolean(rep && rep.type === btn.dataset.report));
    });
    if (btnClearReport) btnClearReport.classList.toggle('hidden', !rep);
    if (modalReportNote) {
      if (!rep) {
        modalReportNote.textContent = '보강·시험·잠김 등 시간표와 다른 상황을 발견하면 눌러 표시해 둘 수 있습니다.';
      } else {
        const label = rep.type === 'locked' ? '문 잠김' : '수업·시험 중';
        modalReportNote.textContent = `현재 "${label}"으로 제보됨 (${rep.timeText} 기록 · 이 브라우저에 저장)`;
      }
    }
  }

  function openRoomModal(room, day, timeMin, freeUntil, freeMinutes) {
    activeModalContext = { room, day, timeMin };
    modalRoomTitle.textContent = room.id;
    const officialTag = isOfficialExamOpen(room, timeMin) ? ' · 시험기간 18~22시 공식 개방 대상' : '';
    modalRoomSub.textContent = `${room.building} · 추정 약 ${room.seats}석 · ${DAY_NAMES[day]}${officialTag}`;
    modalStatusBox.textContent = `${formatMin(timeMin)}부터 ${formatMin(freeUntil)}까지 비어 있음 (${formatDuration(freeMinutes)})`;

    const classes = (room.schedule && room.schedule[day]) || [];

    // Timeline Bar
    modalTimelineBar.innerHTML = '';
    for (let i = 0; i < classes.length; i++) {
      const c = classes[i];
      const start = Math.max(DAY_START, c.s);
      const end = Math.min(DAY_END, c.e);
      if (end <= start) continue;
      const leftPct = ((start - DAY_START) / TOTAL_DAY_MIN) * 100;
      const widthPct = ((end - start) / TOTAL_DAY_MIN) * 100;
      const busyEl = document.createElement('div');
      busyEl.className = 'timeline-busy';
      busyEl.style.left = `${leftPct}%`;
      busyEl.style.width = `${widthPct}%`;
      busyEl.title = `${formatMin(c.s)}~${formatMin(c.e)} ${c.t}`;
      modalTimelineBar.appendChild(busyEl);
    }

    const markerPct = ((timeMin - DAY_START) / TOTAL_DAY_MIN) * 100;
    const marker = document.createElement('div');
    marker.className = 'timeline-marker';
    marker.style.left = `${markerPct}%`;
    modalTimelineBar.appendChild(marker);

    // Class List
    modalClassListLabel.textContent = `${DAY_NAMES[day]} 예정된 수업 (${classes.length}건)`;
    modalClassList.innerHTML = '';
    if (classes.length === 0) {
      const li = document.createElement('li');
      li.className = 'class-item';
      li.innerHTML = '<span class="class-time">종일</span><span class="class-name">예정된 정규 수업 없음</span>';
      modalClassList.appendChild(li);
    } else {
      for (let i = 0; i < classes.length; i++) {
        const c = classes[i];
        const li = document.createElement('li');
        li.className = 'class-item';
        const profHtml = c.p ? `<span class="class-prof">${escapeHtml(c.p)}</span>` : '';
        li.innerHTML = `
          <span class="class-time">${formatMin(c.s)}~${formatMin(c.e)}</span>
          <span class="class-name">${escapeHtml(c.t)}${profHtml}</span>
        `;
        modalClassList.appendChild(li);
      }
    }

    syncModalReportUI();
    roomModalBackdrop.classList.remove('hidden');
  }

  function closeRoomModal() {
    roomModalBackdrop.classList.add('hidden');
  }

  // --- Natural Language Query -> find_empty_rooms Tool Call ---
  function parseNaturalQuery(text) {
    const nowDef = getNowDefaults();
    let day = selectDay.value || nowDef.day;
    let timeMin = parseInt(selectTime.value, 10) || nowDef.timeMin;
    let building = '전체';
    let minMinutes = 60;

    // 1) Day parsing
    if (/오늘|지금|현재/.test(text)) {
      day = nowDef.day;
    } else if (/내일/.test(text)) {
      const order = ['월', '화', '수', '목', '금'];
      const idx = order.indexOf(nowDef.day);
      day = order[(idx + 1) % order.length];
    } else {
      const mDay = text.match(/([월화수목금])(?:요일)?/);
      if (mDay) day = mDay[1];
    }

    // 2) Time parsing
    if (/지금|현재/.test(text) && !/\d{1,2}\s*[:시]/.test(text)) {
      timeMin = nowDef.timeMin;
    } else {
      const mColon = text.match(/(오전|오후|저녁|밤)?\s*(\d{1,2}):(\d{2})/);
      const mKorean = text.match(/(오전|오후|저녁|밤)?\s*(\d{1,2})\s*시\s*(반|(\d{1,2})\s*분)?/);

      if (mColon) {
        let h = parseInt(mColon[2], 10);
        const m = parseInt(mColon[3], 10);
        if ((mColon[1] === '오후' || mColon[1] === '저녁' || mColon[1] === '밤') && h < 12) h += 12;
        timeMin = Math.floor((h * 60 + m) / 30) * 30;
      } else if (mKorean) {
        let h = parseInt(mKorean[2], 10);
        let m = 0;
        if (mKorean[3] === '반') m = 30;
        else if (mKorean[4]) m = parseInt(mKorean[4], 10);
        const period = mKorean[1];
        if ((period === '오후' || period === '저녁' || period === '밤') && h < 12) h += 12;
        else if (!period && h >= 1 && h <= 8) h += 12; // "2시" -> 14:00, "6시" -> 18:00
        timeMin = Math.floor((h * 60 + m) / 30) * 30;
      } else if (/저녁/.test(text)) {
        timeMin = 18 * 60;
      } else if (/점심/.test(text)) {
        timeMin = 12 * 60;
      } else if (/오전|아침/.test(text)) {
        timeMin = 9 * 60;
      }
    }
    timeMin = Math.max(DAY_START, Math.min(DAY_END - 30, timeMin));

    // 3) Building parsing
    if (/광개토|광관/.test(text)) building = '광개토관';
    else if (/대양|AI|ai|에이아이|센/.test(text)) building = '대양AI센터';
    else if (/집현/.test(text)) building = '집현관';
    else if (/충무/.test(text)) building = '충무관';
    else if (/군자/.test(text)) building = '군자관';
    else if (/전체|모든|어디|아무/.test(text)) building = '전체';

    // 4) Min duration parsing
    const mDurH = text.match(/(\d+)\s*시간\s*(반|30분)?/);
    const mDurM = text.match(/(\d+)\s*분\s*(이상|동안|비|공부)/);
    if (mDurH) {
      minMinutes = parseInt(mDurH[1], 10) * 60 + (mDurH[2] ? 30 : 0);
    } else if (mDurM) {
      minMinutes = Math.max(30, Math.round(parseInt(mDurM[1], 10) / 30) * 30);
    } else if (/잠깐|짧게|30분/.test(text)) {
      minMinutes = 30;
    } else if (/오래|길게/.test(text)) {
      minMinutes = 180;
    } else if (/10시\s*30분|전체\s*건물\s*빈/.test(text)) {
      minMinutes = 30;
    }

    // Clamp minMinutes to supported options for UI sync
    const allowedMins = [30, 60, 120, 180, 240];
    let nearestMin = allowedMins[0];
    for (let i = 0; i < allowedMins.length; i++) {
      if (Math.abs(allowedMins[i] - minMinutes) < Math.abs(nearestMin - minMinutes)) {
        nearestMin = allowedMins[i];
      }
    }
    minMinutes = nearestMin;

    // 5) Floor parsing
    let floor = 'all';
    if (/3층\s*이하|저층|낮은\s*층|1~3층|1-3층/.test(text)) floor = 'low';
    else if (/4층\s*이상|고층|높은\s*층/.test(text)) floor = 'high';

    return { day, timeMin, building, minMinutes, floor };
  }

  function setFloorFilter(val) {
    floorFilter = val;
    floorChipBtns.forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.floor === val);
    });
  }

  function handleAiQuery(queryText) {
    const trimmed = queryText.trim();
    if (!trimmed) return;

    // Append user bubble
    const userDiv = document.createElement('div');
    userDiv.className = 'ai-msg ai-msg--user';
    userDiv.textContent = trimmed;
    aiMessages.appendChild(userDiv);

    // Parse & invoke find_empty_rooms tool
    const params = parseNaturalQuery(trimmed);
    const results = find_empty_rooms(params);

    const botDiv = document.createElement('div');
    botDiv.className = 'ai-msg ai-msg--bot';

    const isEveningQuery = params.timeMin >= EVENING_START;
    const isBlockedQuery = isEveningQuery && params.building !== '전체' && params.building !== '광개토관';
    const floorArg = params.floor !== 'all' ? `, floor="${params.floor === 'low' ? '3층 이하' : '4층 이상'}"` : '';
    const toolArgs = `day="${params.day}", time="${formatMin(params.timeMin)}", building="${params.building}", min="${formatDuration(params.minMinutes)}"${floorArg}`;
    const buildingLabel =
      params.building === '전체'
        ? (isEveningQuery ? '광개토관 1~4층 (18시 이후 공식 개방)' : '주요 5개 건물 전체')
        : params.building;
    const floorText = params.floor === 'low' ? ' (3층 이하)' : params.floor === 'high' ? ' (4층 이상)' : '';

    let bodyHtml = `<div class="ai-tool-badge">tool: find_empty_rooms(${escapeHtml(toolArgs)})</div>`;
    let applyBuilding = params.building;

    if (isBlockedQuery) {
      const altResults = find_empty_rooms({ ...params, building: '광개토관' });
      applyBuilding = '광개토관';
      bodyHtml += `<p><strong>18:00 이후</strong>에는 <strong>${escapeHtml(params.building)}</strong> 강의실을 사용할 수 없습니다. 저녁(18:00~22:00) 공식 개방은 <strong>광개토관 1~4층</strong>만 운영됩니다.</p>`;
      if (altResults.length > 0) {
        const topAlt = altResults.slice(0, 10);
        const altTags = topAlt
          .map((r) => `<span class="ai-room-tag">${escapeHtml(r.room.id)} (~${formatMin(r.freeUntil)})</span>`)
          .join('');
        const moreAlt = altResults.length > 10 ? ` 외 ${altResults.length - 10}실` : '';
        bodyHtml += `
          <p>대신 같은 시각 <strong>광개토관 1~4층</strong>에서 <strong>${altResults.length}실</strong>을 이용할 수 있습니다.</p>
          <div class="ai-room-tags">${altTags}${moreAlt ? `<span class="ai-room-tag">${moreAlt}</span>` : ''}</div>
        `;
      }
    } else if (results.length === 0) {
      bodyHtml += `<p><strong>${DAY_NAMES[params.day]} ${formatMin(params.timeMin)}</strong> 기준, ${buildingLabel}${floorText}에서 ${minLabel(params.minMinutes)} 비어 있는 강의실이 없습니다.</p>`;
    } else {
      const top = results.slice(0, 12);
      const tagsHtml = top
        .map((r) => `<span class="ai-room-tag">${escapeHtml(r.room.id)} (~${formatMin(r.freeUntil)})</span>`)
        .join('');
      const moreText = results.length > 12 ? ` 외 ${results.length - 12}실` : '';
      bodyHtml += `
        <p><strong>${DAY_NAMES[params.day]} ${formatMin(params.timeMin)}</strong> 기준, ${buildingLabel}${floorText}에서 ${minLabel(params.minMinutes)} 비어 있는 강의실은 총 <strong>${results.length}실</strong>입니다.</p>
        <div class="ai-room-tags">${tagsHtml}${moreText ? `<span class="ai-room-tag">${moreText}</span>` : ''}</div>
      `;
    }

    bodyHtml += `
      <p class="ai-disclaimer">※ 2026-2학기 정규 시간표 기준이며, 18:00 이후에는 광개토관 1~4층만 공식 개방됩니다.</p>
      <button type="button" class="ai-apply-btn">${isBlockedQuery ? '광개토관 1~4층으로 화면에 적용하기 →' : '이 조건으로 화면에 적용하기 →'}</button>
    `;

    botDiv.innerHTML = bodyHtml;
    const applyBtn = botDiv.querySelector('.ai-apply-btn');
    applyBtn.addEventListener('click', () => {
      selectDay.value = params.day;
      selectTime.value = String(params.timeMin);
      selectBuilding.value = applyBuilding;
      selectMinHours.value = String(params.minMinutes);
      setFloorFilter(params.floor);
      render();
      closeAiModal();
    });

    aiMessages.appendChild(botDiv);
    aiMessages.scrollTop = aiMessages.scrollHeight;
  }

  function openAiModal() {
    aiModalBackdrop.classList.remove('hidden');
    setTimeout(() => aiInput.focus(), 50);
  }

  function closeAiModal() {
    aiModalBackdrop.classList.add('hidden');
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- Event Listeners ---
  selectDay.addEventListener('change', render);
  selectTime.addEventListener('change', render);
  selectBuilding.addEventListener('change', render);
  selectMinHours.addEventListener('change', render);

  btnNow.addEventListener('click', () => {
    const def = getNowDefaults();
    selectDay.value = def.day;
    selectTime.value = String(def.timeMin);
    render();
  });

  if (btnSwitchGwang) {
    btnSwitchGwang.addEventListener('click', () => {
      selectBuilding.value = '광개토관';
      render();
    });
  }

  floorChipBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setFloorFilter(btn.dataset.floor);
      render();
    });
  });

  sortBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      sortMode = btn.dataset.sort;
      sortBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
      render();
    });
  });

  btnCloseRoomModal.addEventListener('click', closeRoomModal);
  roomModalBackdrop.addEventListener('click', (e) => {
    if (e.target === roomModalBackdrop) closeRoomModal();
  });

  if (modalReportActions) {
    modalReportActions.addEventListener('click', (e) => {
      const btn = e.target.closest('.report-btn[data-report]');
      if (!btn || !activeModalContext) return;
      const { room, day } = activeModalContext;
      const now = new Date();
      const timeText = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      roomReports[getReportKey(room.id, day)] = { type: btn.dataset.report, timeText };
      saveReports();
      syncModalReportUI();
      render();
    });
  }

  if (btnClearReport) {
    btnClearReport.addEventListener('click', () => {
      if (!activeModalContext) return;
      const { room, day } = activeModalContext;
      delete roomReports[getReportKey(room.id, day)];
      saveReports();
      syncModalReportUI();
      render();
    });
  }

  function openNearbyModal() {
    nearbyModalBackdrop.classList.remove('hidden');
    renderNearbySearch(nearbySearchInput.value);
    setTimeout(() => nearbySearchInput.focus(), 50);
  }

  function closeNearbyModal() {
    nearbyModalBackdrop.classList.add('hidden');
  }

  function renderNearbySearch(query) {
    const q = (query || '').trim().toLowerCase();
    let matches;
    if (!q) {
      // Show a few popular/representative courses as quick examples
      matches = COURSE_INDEX.slice(0, 20);
    } else {
      const tokens = q.split(/\s+/).filter(Boolean);
      matches = COURSE_INDEX.filter((item) =>
        tokens.every((tk) => item.searchKey.includes(tk))
      ).slice(0, 30);
    }

    nearbyResults.innerHTML = '';
    if (matches.length === 0) {
      nearbyResults.innerHTML = '<div class="nearby-empty">일치하는 수업이 없습니다. 과목명이나 강의실(예: 광202, 센B105)로 검색해 보세요.</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    for (let i = 0; i < matches.length; i++) {
      const c = matches[i];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nearby-item';
      const profStr = c.prof ? ` · ${c.prof}` : '';
      btn.innerHTML = `
        <div>
          <div class="nearby-item-title">${escapeHtml(c.title)}</div>
          <div class="nearby-item-meta">${DAY_NAMES[c.day]} ${formatMin(c.start)}~${formatMin(c.end)}${escapeHtml(profStr)}</div>
        </div>
        <span class="nearby-item-room">${escapeHtml(c.roomId)}</span>
      `;
      btn.addEventListener('click', () => {
        const whenRadio = document.querySelector('input[name="nearbyWhen"]:checked');
        const mode = whenRadio ? whenRadio.value : 'after';
        let targetMin = mode === 'before' ? c.start - 120 : c.end;
        targetMin = Math.max(DAY_START, Math.min(DAY_END - 30, Math.floor(targetMin / 30) * 30));

        anchorClass = c;
        selectDay.value = c.day;
        selectTime.value = String(targetMin);
        selectBuilding.value = '전체';
        selectMinHours.value = '60';
        setFloorFilter('all');
        closeNearbyModal();
        render();
      });
      frag.appendChild(btn);
    }
    nearbyResults.appendChild(frag);
  }

  btnOpenNearby.addEventListener('click', openNearbyModal);
  btnCloseNearbyModal.addEventListener('click', closeNearbyModal);
  nearbyModalBackdrop.addEventListener('click', (e) => {
    if (e.target === nearbyModalBackdrop) closeNearbyModal();
  });
  nearbySearchInput.addEventListener('input', (e) => renderNearbySearch(e.target.value));
  btnClearAnchor.addEventListener('click', () => {
    anchorClass = null;
    render();
  });

  btnOpenAi.addEventListener('click', openAiModal);
  btnCloseAiModal.addEventListener('click', closeAiModal);
  aiModalBackdrop.addEventListener('click', (e) => {
    if (e.target === aiModalBackdrop) closeAiModal();
  });

  aiForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = aiInput.value;
    aiInput.value = '';
    handleAiQuery(q);
  });

  aiMessages.addEventListener('click', (e) => {
    const chip = e.target.closest('.ai-chip');
    if (chip && chip.dataset.q) {
      handleAiQuery(chip.dataset.q);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeRoomModal();
      closeAiModal();
      closeNearbyModal();
      closeAllCustomSelects(null);
    }
  });

  // --- Sleek Custom Dropdown Enhancer ---
  const customSelectUpdaters = new Map();

  function closeAllCustomSelects(exceptEl) {
    document.querySelectorAll('.custom-select.is-open').forEach((el) => {
      if (el !== exceptEl) {
        el.classList.remove('is-open');
        const btn = el.querySelector('.custom-select-trigger');
        if (btn) btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function enhanceSelect(selectEl) {
    const wrap = selectEl.parentElement;
    if (!wrap) return;
    wrap.classList.add('custom-select');
    selectEl.classList.add('sr-only-select');
    selectEl.tabIndex = -1;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const labelSpan = document.createElement('span');
    labelSpan.className = 'custom-select-value';

    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('class', 'custom-select-chevron');
    chevron.setAttribute('width', '16');
    chevron.setAttribute('height', '16');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.setAttribute('fill', 'none');
    chevron.setAttribute('stroke', 'currentColor');
    chevron.setAttribute('stroke-width', '2');
    chevron.setAttribute('stroke-linecap', 'round');
    chevron.setAttribute('stroke-linejoin', 'round');
    chevron.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';

    trigger.appendChild(labelSpan);
    trigger.appendChild(chevron);

    const menu = document.createElement('ul');
    menu.className = 'custom-select-menu';
    menu.setAttribute('role', 'listbox');

    function syncUI() {
      const selectedOpt = selectEl.options[selectEl.selectedIndex];
      labelSpan.textContent = selectedOpt ? selectedOpt.textContent : '';
      menu.innerHTML = '';
      for (let i = 0; i < selectEl.options.length; i++) {
        const opt = selectEl.options[i];
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        const isSel = opt.value === selectEl.value;
        li.setAttribute('aria-selected', isSel ? 'true' : 'false');

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'custom-select-option' + (isSel ? ' is-selected' : '');
        btn.innerHTML = `
          <span>${escapeHtml(opt.textContent)}</span>
          <svg class="check-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        `;
        btn.addEventListener('click', () => {
          selectEl.value = opt.value;
          syncUI();
          wrap.classList.remove('is-open');
          trigger.setAttribute('aria-expanded', 'false');
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        });
        li.appendChild(btn);
        menu.appendChild(li);
      }
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !wrap.classList.contains('is-open');
      closeAllCustomSelects(wrap);
      wrap.classList.toggle('is-open', willOpen);
      trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      if (willOpen) {
        const active = menu.querySelector('.is-selected');
        if (active) active.scrollIntoView({ block: 'nearest' });
      }
    });

    wrap.appendChild(trigger);
    wrap.appendChild(menu);
    customSelectUpdaters.set(selectEl, syncUI);
    syncUI();
  }

  function syncAllCustomSelects() {
    customSelectUpdaters.forEach((fn) => fn());
  }

  document.addEventListener('click', () => closeAllCustomSelects(null));

  // --- Initialization ---
  initTimeOptions();

  // Check URL query params (useful for sharing / demo), otherwise default to PPT demo view or live time
  const qs = new URLSearchParams(window.location.search);
  const qDay = qs.get('day');
  const qTime = qs.get('time');
  const qBuilding = qs.get('building');
  const qMin = qs.get('min');

  if (qDay || qTime || qBuilding || qMin) {
    selectDay.value = DAY_NAMES[qDay] ? qDay : '목';
    if (qTime && /^\d{1,2}:\d{2}$/.test(qTime)) {
      const [h, m] = qTime.split(':').map(Number);
      selectTime.value = String(Math.max(DAY_START, Math.min(DAY_END - 30, h * 60 + m)));
    } else {
      selectTime.value = String(18 * 60);
    }
    selectBuilding.value = qBuilding || '광개토관';
    selectMinHours.value = qMin || '120';
  } else {
    // Default to PPT Slide 11 initial screen: 목요일 18:00 · 광개토관 · 2시간 이상 (17실)
    // Users can tap "지금 시각" pill anytime for current day/time
    selectDay.value = '목';
    selectTime.value = String(18 * 60);
    selectBuilding.value = '광개토관';
    selectMinHours.value = '120';
  }

  enhanceSelect(selectDay);
  enhanceSelect(selectTime);
  enhanceSelect(selectBuilding);
  enhanceSelect(selectMinHours);

  // Keep custom selects synced when changed programmatically
  const origRender = render;
  render = function () {
    syncAllCustomSelects();
    origRender();
  };

  render();

  // Register Service Worker (PWA) when served over HTTP/HTTPS
  if ('serviceWorker' in navigator && (location.protocol === 'http:' || location.protocol === 'https:')) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.update();
    }).catch(() => {});
  }
})();
