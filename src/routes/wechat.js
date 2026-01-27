/**
 * 微信 JS-SDK 签名路由
 */
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const router = express.Router();

const APP_ID = process.env.WECHAT_APP_ID;
const APP_SECRET = process.env.WECHAT_APP_SECRET;
const CACHE_SKEW_MS = 60 * 1000;

let accessTokenCache = { value: null, expiresAt: 0 };
let jsapiTicketCache = { value: null, expiresAt: 0 };

function isExpired(cache) {
  return !cache.value || Date.now() >= cache.expiresAt;
}

function getRequestOrigin(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol;
  return `${proto}://${req.get('host')}`;
}

function createNonceStr() {
  return crypto.randomBytes(8).toString('hex');
}

async function fetchAccessToken() {
  if (!APP_ID || !APP_SECRET) {
    throw new Error('WECHAT_CONFIG_MISSING');
  }
  if (!isExpired(accessTokenCache)) {
    return accessTokenCache.value;
  }

  const response = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
    params: {
      grant_type: 'client_credential',
      appid: APP_ID,
      secret: APP_SECRET
    },
    timeout: 8000
  });

  const data = response.data || {};
  if (!data.access_token) {
    throw new Error(data.errmsg || 'WECHAT_ACCESS_TOKEN_ERROR');
  }

  const expiresIn = (data.expires_in || 7200) * 1000;
  accessTokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + expiresIn - CACHE_SKEW_MS
  };

  return accessTokenCache.value;
}

async function fetchJsApiTicket() {
  if (!isExpired(jsapiTicketCache)) {
    return jsapiTicketCache.value;
  }

  const accessToken = await fetchAccessToken();
  const response = await axios.get('https://api.weixin.qq.com/cgi-bin/ticket/getticket', {
    params: {
      access_token: accessToken,
      type: 'jsapi'
    },
    timeout: 8000
  });

  const data = response.data || {};
  if (data.errcode !== 0 || !data.ticket) {
    throw new Error(data.errmsg || 'WECHAT_TICKET_ERROR');
  }

  const expiresIn = (data.expires_in || 7200) * 1000;
  jsapiTicketCache = {
    value: data.ticket,
    expiresAt: Date.now() + expiresIn - CACHE_SKEW_MS
  };

  return jsapiTicketCache.value;
}

function signJsSdk(ticket, nonceStr, timestamp, url) {
  const raw = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
  return crypto.createHash('sha1').update(raw).digest('hex');
}

/**
 * POST /api/wechat/jssdk-signature
 * body: { url }
 */
router.post('/jssdk-signature', async (req, res) => {
  if (!APP_ID || !APP_SECRET) {
    return res.status(500).json({
      error: '微信配置缺失',
      code: 'WECHAT_CONFIG_MISSING'
    });
  }

  const url = (req.body && req.body.url) || (req.query && req.query.url);
  if (!url) {
    return res.status(400).json({
      error: '缺少 url',
      code: 'MISSING_URL'
    });
  }

  const cleanUrl = String(url).split('#')[0];
  const origin = getRequestOrigin(req);
  if (!cleanUrl.startsWith(origin)) {
    return res.status(400).json({
      error: 'URL 不合法',
      code: 'INVALID_URL'
    });
  }

  try {
    const ticket = await fetchJsApiTicket();
    const nonceStr = createNonceStr();
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signJsSdk(ticket, nonceStr, timestamp, cleanUrl);

    res.json({
      appId: APP_ID,
      timestamp,
      nonceStr,
      signature
    });
  } catch (error) {
    console.error('微信 JS-SDK 签名失败:', error.message);
    res.status(500).json({
      error: '签名失败',
      code: 'WECHAT_SIGN_ERROR'
    });
  }
});

/**
 * GET /api/wechat/outbound-ip
 * 获取服务器出口 IP（用于白名单配置）
 */
router.get('/outbound-ip', async (req, res) => {
  try {
    const response = await axios.get('https://api.ipify.org', {
      params: { format: 'json' },
      timeout: 5000
    });
    const ip = response.data && response.data.ip;
    if (!ip) {
      return res.status(500).json({
        error: '无法解析出口 IP',
        code: 'OUTBOUND_IP_ERROR'
      });
    }
    res.json({ ip });
  } catch (error) {
    console.error('获取出口 IP 失败:', error.message);
    res.status(500).json({
      error: '获取出口 IP 失败',
      code: 'OUTBOUND_IP_ERROR'
    });
  }
});

module.exports = router;
