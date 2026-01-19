/**
 * timeParser.js - 자연어 시간 파싱 모듈
 * "9시 미팅", "오후 3시 회의" 등에서 시간을 추출
 */

// 날짜/시간 관련 키워드 (cleanText에서 제거할 것들)
const DATE_KEYWORDS = ['오늘', '내일', '모레', '글피'];
const TIME_PERIODS = ['오전', '오후', '아침', '저녁', '낮', '밤'];

/**
 * 텍스트에서 시간 정보를 파싱
 * @param {string} text - 파싱할 텍스트
 * @returns {object|null} - { hour, minute, period, dayOffset, original, cleanText } 또는 null
 */
export function parseTime(text) {
  if (!text) return null;

  // 날짜 키워드 확인
  let dayOffset = 0;
  let dateKeyword = '';
  for (const keyword of DATE_KEYWORDS) {
    if (text.includes(keyword)) {
      dateKeyword = keyword;
      if (keyword === '내일') dayOffset = 1;
      else if (keyword === '모레') dayOffset = 2;
      else if (keyword === '글피') dayOffset = 3;
      break;
    }
  }

  // 패턴들 (우선순위 순서)
  const patterns = [
    // "오전/오후 9시 30분" or "오전/오후 9시 반"
    {
      regex: /(오전|오후|아침|저녁|낮|밤)\s*(\d{1,2})시\s*(\d{1,2})분/,
      parse: (m) => ({
        hour: parseInt(m[2]),
        minute: parseInt(m[3]),
        period: m[1],
        original: m[0]
      })
    },
    {
      regex: /(오전|오후|아침|저녁|낮|밤)\s*(\d{1,2})시\s*반/,
      parse: (m) => ({
        hour: parseInt(m[2]),
        minute: 30,
        period: m[1],
        original: m[0]
      })
    },
    // "오전/오후 9시"
    {
      regex: /(오전|오후|아침|저녁|낮|밤)\s*(\d{1,2})시/,
      parse: (m) => ({
        hour: parseInt(m[2]),
        minute: 0,
        period: m[1],
        original: m[0]
      })
    },
    // "9시 30분" or "9시 반"
    {
      regex: /(\d{1,2})시\s*(\d{1,2})분/,
      parse: (m) => ({
        hour: parseInt(m[1]),
        minute: parseInt(m[2]),
        period: null,
        original: m[0]
      })
    },
    {
      regex: /(\d{1,2})시\s*반/,
      parse: (m) => ({
        hour: parseInt(m[1]),
        minute: 30,
        period: null,
        original: m[0]
      })
    },
    // "9시"
    {
      regex: /(\d{1,2})시/,
      parse: (m) => ({
        hour: parseInt(m[1]),
        minute: 0,
        period: null,
        original: m[0]
      })
    },
    // "14:30" or "9:30" (24시간 형식)
    {
      regex: /(\d{1,2}):(\d{2})/,
      parse: (m) => ({
        hour: parseInt(m[1]),
        minute: parseInt(m[2]),
        period: null,
        original: m[0]
      })
    }
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (match) {
      const result = pattern.parse(match);

      // 시간 유효성 검사
      if (result.hour < 0 || result.hour > 23) continue;
      if (result.minute < 0 || result.minute > 59) continue;

      // 24시간 형식으로 변환 (가장 가까운 미래 시간)
      result.hour24 = convertTo24Hour(result.hour, result.period, result.minute);

      // 날짜 오프셋 저장
      result.dayOffset = dayOffset;

      // 시간/날짜 관련 텍스트를 모두 제거한 순수 할일 텍스트
      let cleanText = text;
      // 시간 패턴 제거
      cleanText = cleanText.replace(result.original, '');
      // 날짜 키워드 제거
      for (const keyword of DATE_KEYWORDS) {
        cleanText = cleanText.replace(keyword, '');
      }
      // 공백 정리
      result.cleanText = cleanText.replace(/\s+/g, ' ').trim();

      // 포맷된 시간 문자열
      result.formatted = formatTime(result.hour24, result.minute);

      return result;
    }
  }

  return null;
}

/**
 * 12시간 형식을 24시간 형식으로 변환
 * period가 없으면 현재 시간 기준 가장 가까운 미래 시간으로 설정
 */
function convertTo24Hour(hour, period, minute = 0) {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  if (!period) {
    // period 없으면 가장 가까운 미래 시간으로 자동 설정
    // 예: 현재 오후 9시인데 "10시"라고 쓰면 → 오후 10시 (22시)

    if (hour <= 12) {
      // 1~12시 입력된 경우
      const amOption = hour === 12 ? 0 : hour;  // 오전 (12시는 0시)
      const pmOption = hour === 12 ? 12 : hour + 12;  // 오후

      // 현재 시간보다 큰 가장 가까운 옵션 선택
      const nowMinutes = currentHour * 60 + currentMinute;
      const amMinutes = amOption * 60 + minute;
      const pmMinutes = pmOption * 60 + minute;

      // 오전 시간이 미래인 경우
      if (amMinutes > nowMinutes) {
        return amOption;
      }
      // 오후 시간이 미래인 경우
      if (pmMinutes > nowMinutes) {
        return pmOption;
      }
      // 둘 다 지났으면 내일 오전으로 (일단 오전 반환)
      return amOption;
    } else {
      // 13~23시 입력된 경우 (24시간 형식)
      return hour;
    }
  }

  const isPM = ['오후', '저녁', '밤'].includes(period);
  const isAM = ['오전', '아침'].includes(period);
  const isNoon = period === '낮';

  if (isPM && hour < 12) {
    return hour + 12;
  }
  if (isAM && hour === 12) {
    return 0;
  }
  if (isNoon && hour < 12) {
    return hour + 12; // 낮은 오후로 처리
  }

  return hour;
}

/**
 * 시간을 보기 좋게 포맷
 */
function formatTime(hour, minute) {
  const h = hour.toString().padStart(2, '0');
  const m = minute.toString().padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * 체크박스 라인에서 시간 정보 추출
 * @param {string} line - 체크박스가 포함된 한 줄
 * @returns {object|null}
 */
export function parseCheckboxTime(line) {
  // 체크박스로 시작하는지 확인
  const checkboxMatch = line.match(/^(\s*[☐☑]\s*)/);
  if (!checkboxMatch) return null;

  const afterCheckbox = line.slice(checkboxMatch[0].length);
  const timeInfo = parseTime(afterCheckbox);

  if (timeInfo) {
    timeInfo.isChecked = line.includes('☑');
    timeInfo.fullLine = line;
  }

  return timeInfo;
}

/**
 * 여러 줄에서 모든 할일 시간 추출
 * @param {string} content - 전체 콘텐츠
 * @returns {Array} - 시간 정보 배열
 */
export function parseAllTodoTimes(content) {
  if (!content) return [];

  const lines = content.split('\n');
  const todos = [];

  lines.forEach((line, index) => {
    const timeInfo = parseCheckboxTime(line);
    if (timeInfo) {
      timeInfo.lineIndex = index;
      todos.push(timeInfo);
    }
  });

  return todos;
}

/**
 * 시간이 현재 시간 기준으로 얼마나 남았는지 계산
 * 시간이 지났으면 내일로 계산
 * @param {number} hour24 - 24시간 형식 시
 * @param {number} minute - 분
 * @returns {object} - { isPast, minutes, text, isNextDay }
 */
export function getTimeRemaining(hour24, minute) {
  const now = new Date();
  const target = new Date();
  target.setHours(hour24, minute, 0, 0);

  let diffMs = target - now;
  let isNextDay = false;

  // 시간이 지났으면 내일로 설정
  if (diffMs < 0) {
    target.setDate(target.getDate() + 1);
    diffMs = target - now;
    isNextDay = true;
  }

  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins === 0) {
    return {
      isPast: false,
      minutes: 0,
      text: '지금',
      isNextDay: false
    };
  } else if (diffMins < 60) {
    return {
      isPast: false,
      minutes: diffMins,
      text: `${diffMins}분 후`,
      isNextDay
    };
  } else {
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    let text = mins > 0 ? `${hours}시간 ${mins}분 후` : `${hours}시간 후`;
    if (isNextDay) {
      text = `내일 ${hour24.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    }
    return {
      isPast: false,
      minutes: diffMins,
      text,
      isNextDay
    };
  }
}
