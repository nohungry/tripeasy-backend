const bcrypt = require('bcrypt');
const mailer = require('../utils/mailer');
const svgCaptcha = require('svg-captcha');
const { signCaptcha, cookieOptions } = require('../utils/captcha');

const resStatus = require('../utils/resStatus');
const { pool } = require('../config/database');
const { signLoginToken, signResetToken } = require('../utils/authToken');

// [POST] 編號 01 : 使用者註冊、個人偏好設定
async function post_user_SignUp(req, res, next) {
  const { name, email, password, preference } = req.body;
  const [pref1, pref2, pref3] = preference;

  let client;
  try {
    const salt = await bcrypt.genSalt(10);
    const databasePassword = await bcrypt.hash(password, salt);

    client = await pool.connect();
    // 上傳數據
    await client.query('BEGIN');

    const userResult = await client.query(
      'INSERT INTO public."user" (name, email, role, password, preference1, preference2, preference3) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [name, email, 'User', databasePassword, pref1, pref2, pref3]
    );
    const user = userResult.rows[0];

    const levelResult = await client.query(
      'INSERT INTO public."user_level" (user_id,level,name,badge_url,travel_point) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [user.user_id, 'Level 1', '初心旅人', 'https://example.com/badges/level1.png', 0]
    );
    const level = levelResult.rows[0];

    await client.query(
      'INSERT INTO public."point_record" (user_id,type,point) VALUES ($1, $2, $3) RETURNING *',
      [user.user_id, '新增', 0]
    );

    await client.query('COMMIT');

    // [HTTP 201] 呈現上傳後資料
    resStatus({
      res: res,
      status: 201,
      message: '註冊成功',
      dbdata: {
        user: {
          id: user.user_id,
          name: user.name,
          role: user.role,
        },
        level: {
          level: level.level,
          name: level.name,
          points: level.travel_point,
        },
      },
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    // [HTTP 409] 同時註冊同一個 email，撞到 user_email_lower_key
    if (error.code === '23505' && error.constraint === 'user_email_lower_key') {
      return resStatus({
        res: res,
        status: 409,
        message: 'Email已被使用',
      });
    }
    // [HTTP 500] 伺服器異常
    console.error('❌ 伺服器內部錯誤:', error);
    next(error);
  } finally {
    if (client) client.release();
  }
}

// [POST] 編號 02 : 使用者登入 - Email 登入
async function post_user_LoginEmail(req, res, next) {
  const { email } = req.body;

  let client;
  try {
    client = await pool.connect();
    // 更新數據
    await client.query('BEGIN');

    const emailData = await pool.query('SELECT * FROM public."user" where lower(email) = lower($1)', [email]);
    const user = emailData.rows[0];
    // 登入成功後，清除鎖住功能
    await pool.query(
      'UPDATE public."user" SET login_attempts = 0, locked_datetime = null, login_method = 1 WHERE user_id = $1',
      [user.user_id]
    );

    const levelResult = await pool.query('SELECT * FROM public."user_level" where user_id = $1', [
      user.user_id,
    ]);
    const level = levelResult.rows[0];

    await client.query('COMMIT');

    // 簽發 JWT（依你專案調整）
    const token = signLoginToken(user);

    // [HTTP 200] 呈現資料
    resStatus({
      res: res,
      status: 200,
      message: '登入成功',
      dbdata: {
        token: token,
        user: {
          id: user.user_id,
          name: user.name,
          email: user.email,
          avatar_url: user.avatar_url,
        },
        level: {
          level: level.level,
          name: level.name,
          points: level.travel_point,
          badge_url: level.badge_url,
        },
      },
    });
  } catch (error) {
    // [HTTP 500] 伺服器異常
    if (client) await client.query('ROLLBACK');
    console.error('❌ 伺服器內部錯誤:', error);
    next(error);
  } finally {
    if (client) client.release();
  }
}

// [POST] 編號 03 : 使用者登入 - Google 登入
async function post_user_LoginGoogle(req, res, next) {
  // 從中介軟體取得已驗證的 Google 使用者資訊和權杖
  const { googleUser } = req.user;
  const { name, picture } = googleUser;
  // email 一律轉小寫，與 lower(email) 唯一索引一致
  const email = String(googleUser.email).toLowerCase();
  // Google 的使用者唯一 ID，用來存儲在 socialLogin 表中
  const provider_id = googleUser.sub;

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN'); // 開始資料庫交易

    // 1. 檢查使用者是否已存在於資料庫中（鎖列，避免與同一帳號的其他交易交錯）
    const { rows: existingUsers } = await client.query(
      'SELECT * FROM public."user" WHERE lower(email) = lower($1) FOR UPDATE',
      [email]
    );
    let user = existingUsers[0];

    // 2. 根據使用者是否存在，執行不同邏輯
    if (user) {
      // 2a. 既有會員：是否已綁定過 Google
      const { rows: bound } = await client.query(
        `SELECT 1 FROM public."socialLogin" WHERE user_id = $1 AND provider_method = 'google'`,
        [user.user_id]
      );

      if (bound.length === 0) {
        // 首次綁定：清掉密碼（防預先劫持：先用受害者 email 註冊的人，舊密碼與舊 token 都失效）
        // RETURNING * 帶回更新後的 password（NULL），signLoginToken 以它計算 pwv
        const updated = await client.query(
          `UPDATE public."user"
           SET password = NULL, avatar_url = COALESCE(avatar_url, $1), login_method = 2, updated_at = NOW()
           WHERE user_id = $2 RETURNING *`,
          [picture, user.user_id]
        );
        user = updated.rows[0];
        await client.query(
          `INSERT INTO public."socialLogin" (user_id, provider_method, provider_id, provider_token)
           VALUES ($1, 'google', $2, NULL)`,
          [user.user_id, provider_id]
        );
      } else {
        // 已綁定：只更新頭像、登入方式與 provider_id，密碼不動
        const updated = await client.query(
          `UPDATE public."user"
           SET avatar_url = COALESCE(avatar_url, $1), login_method = 2, updated_at = NOW()
           WHERE user_id = $2 RETURNING *`,
          [picture, user.user_id]
        );
        user = updated.rows[0];
        await client.query(
          `UPDATE public."socialLogin"
           SET provider_id = $1, provider_token = NULL, updated_at = NOW()
           WHERE user_id = $2 AND provider_method = 'google'`,
          [provider_id, user.user_id]
        );
      }
    } else {
      // 2b. 如果使用者不存在，執行完整的全新註冊流程；Google 會員沒有密碼（NULL）
      const newUserResult = await client.query(
        'INSERT INTO public."user" (name, email, role, password, avatar_url, login_method, preference1, preference2, preference3) VALUES ($1, $2, $3, NULL, $4, 2, 1, 2, 3) RETURNING *',
        [name, email, 'User', picture]
      );
      user = newUserResult.rows[0];

      // 為新使用者建立相關的初始紀錄
      await client.query(
        'INSERT INTO public."user_level" (user_id,level,name,badge_url,travel_point) VALUES ($1, $2, $3, $4, $5)',
        [user.user_id, 'Level 1', '初心旅人', 'https://example.com/badges/level1.png', 0]
      );
      await client.query(
        'INSERT INTO public."point_record" (user_id,type,point) VALUES ($1, $2, $3)',
        [user.user_id, '新增', 0]
      );
      await client.query(
        `INSERT INTO public."socialLogin" (user_id, provider_method, provider_id, provider_token) VALUES ($1, 'google', $2, NULL)`,
        [user.user_id, provider_id]
      );
    }

    // 3. 提交資料庫交易
    await client.query('COMMIT');

    // 4. 取得使用者的等級資訊
    const levelResult = await pool.query('SELECT * FROM public."user_level" where user_id = $1', [
      user.user_id,
    ]);
    const level = levelResult.rows[0];

    // 5. 簽發 JWT 權杖並回傳成功的響應
    const token = signLoginToken(user);

    return resStatus({
      res: res,
      status: 200,
      message: '登入成功',
      dbdata: {
        token: token,
        user: {
          id: user.user_id,
          name: user.name,
          email: user.email,
          avatar_url: user.avatar_url,
        },
        level: {
          level: level.level,
          name: level.name,
          points: level.travel_point,
          badge_url: level.badge_url,
        },
      },
    });

  } catch (error) {
    // 如果過程中發生任何錯誤，則回滾資料庫交易
    if (client) await client.query('ROLLBACK');
    // [HTTP 409] 同一個 email 同時首次 Google 登入，撞到 user_email_lower_key
    if (error.code === '23505' && error.constraint === 'user_email_lower_key') {
      return resStatus({
        res: res,
        status: 409,
        message: 'Email已被使用',
      });
    }
    console.error('❌ Google 登入控制器錯誤:', error);
    next(error); // 將錯誤傳遞給 Express 的錯誤處理中介軟體
  } finally {
    // 無論成功或失敗，最後都釋放資料庫連線
    if (client) client.release();
  }
}

// [POST] 編號 04 : 使用者登入 - FB 登入

// [POST] 編號 05 : 使用者忘記密碼 ( 修改密碼畫面 )
async function post_user_forgetPW(req, res, next) {
  const { email } = req.body;

  try {
    // 簽發 JWT（依你專案調整）
    const emailData = await pool.query('SELECT * FROM public."user" where lower(email) = lower($1)', [email]);
    const user = emailData.rows[0];

    const reset_token = signResetToken(user);

    // 📬 發送 Email
    const resetUrl = `${process.env.FRONTEND_PATH}/#/admin/resetpw?token=${reset_token}`;

    await mailer.send({
      to: email,
      subject: 'TripEasy 密碼重設連結',
      html: `
                <p>您好，親愛的用戶 : </p><br>
                <p>請於 15 分鐘內點擊以下連結以重設密碼：</p><br>
                <a href="${resetUrl}">連結 : ${resetUrl}</a>
                <p>若您未曾申請重設密碼，請忽略此信件，謝謝。</p>
            `,
    });

    // [HTTP 200] 呈現資料
    resStatus({
      res: res,
      status: 200,
      message: '連結寄送成功',
    });
  } catch (error) {
    // [HTTP 500] 伺服器異常
    console.error('❌ 伺服器內部錯誤:', error);
    next(error);
  }
}

// [PATCH] 編號 06 : 使用者密碼修改
async function patch_user_resetPW(req, res, next) {
  try {
    // [HTTP 200] 呈現資料
    resStatus({
      res: res,
      status: 200,
      message: '密碼修改成功',
    });
  } catch (error) {
    // [HTTP 500] 伺服器異常
    console.error('❌ 伺服器內部錯誤:', error);
    next(error);
  }
}

// [GET] 編號 07 : 圖片、文字驗證碼判斷機器人
async function get_user_captcha(req, res, next) {
  try {
    const captcha = svgCaptcha.create({
      size: 5,
      noise: 3,
      color: false,
      background: '#eee',
    });

    // 將驗證碼的 HMAC 簽章存在 cookie，5 分鐘內有效
    res.cookie('captcha', signCaptcha(captcha.text), cookieOptions());

    res.type('svg');
    res.send(captcha.data);
  } catch (error) {
    // [HTTP 500] 伺服器異常
    console.error('❌ 伺服器內部錯誤:', error);
    next(error);
  }
}

// [POST] 編號 08 : 使用者登出 ( 以前端處理，不用開發 )
// 無

// [GET] 編號 09 : 驗證使用者登入狀態
async function get_user_loginStatus(req, res, next) {
  try {
    const user = await pool.query('SELECT * FROM public."user" where user_id = $1', [req.user.id]);
    const level = await pool.query('SELECT * FROM public."user_level" where user_id = $1', [
      user.rows[0].user_id,
    ]);

    // [HTTP 200] 呈現資料
    resStatus({
      res: res,
      status: 200,
      message: '登入中',
      dbdata: {
        is_logged_in: true,
        user: {
          id: user.rows[0].user_id,
          name: user.rows[0].name,
          email: user.rows[0].email,
          avatar_url: user.rows[0].avatar_url,
        },
        level: {
          level: level.rows[0].level,
          name: level.rows[0].name,
          points: level.rows[0].travel_point,
          badge_url: level.rows[0].badge_url,
        },
      },
    });
  } catch (error) {
    // [HTTP 500] 伺服器異常
    console.error('❌ 伺服器內部錯誤:', error);
    next(error);
  }
}

module.exports = {
  post_user_SignUp,
  post_user_LoginEmail,
  post_user_LoginGoogle,
  post_user_forgetPW,
  patch_user_resetPW,
  get_user_captcha,
  get_user_loginStatus,
};
