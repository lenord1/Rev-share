// 共享的使用者畫像：問卷、搜尋、抽屜只透過這個物件溝通。只存在使用者自己的瀏覽器（localStorage），不上傳。
export const STORE_KEY = 'ssp.profile.v1';

// null = 還沒回答，與 false「確定沒有」不同（排序不會因為沒回答而扣分）
//   hasPet: null | false | 'cat' | 'dog' | 'other'；hasChild: null | true | false；spaceSize: null | 'small' | 'large'
export const DEFAULT_PROFILE = { hasPet: null, hasChild: null, spaceSize: null, answered: false, skipped: false };

export const petLabel = (v) => ({ cat: '有貓', dog: '有狗', other: '有寵物' })[v] || '';
export const hasPet = (pr) => !!pr.hasPet;

let data = { ...DEFAULT_PROFILE };
const subs = new Set();
try {
  Object.assign(data, JSON.parse(localStorage.getItem(STORE_KEY) || '{}'));
} catch {
  /* 隱私模式讀不到就用預設，不報錯 */
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch {
    /* 寫入失敗不影響使用 */
  }
}

export const Profile = {
  get: () => ({ ...data }),
  /** 問卷、畫像列「修改」、精靈答案都呼叫這裡；訂閱者會自動更新。 */
  set(patch) {
    data = { ...data, ...patch };
    save();
    subs.forEach((fn) => fn(data));
  },
  reset() {
    data = { ...DEFAULT_PROFILE };
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      /* 同上 */
    }
    subs.forEach((fn) => fn(data));
  },
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};
