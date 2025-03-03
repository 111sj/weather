// index.js
// 在实际使用时请替换为您的和风天气API密钥
const WEATHER_API_KEY = 'c7354820cef5435d8f559caeda72170a';
const HISTORY_KEY = 'weather_history';
const MAX_HISTORY = 5;
const MAX_RETRIES = 3;  // 最大重试次数
const RETRY_DELAY = 1000;  // 重试延迟时间（毫秒）

Page({
  data: {
    cityName: '',
    weatherData: null,
    historyList: [],
    isRequesting: false  // 是否正在请求中
  },

  onLoad() {
    // 加载历史记录
    this.loadHistory();
  },

  loadHistory() {
    const history = wx.getStorageSync(HISTORY_KEY) || [];
    this.setData({
      historyList: history
    });
  },

  saveHistory(cityName) {
    let history = wx.getStorageSync(HISTORY_KEY) || [];
    
    // 如果城市已存在，先删除旧记录
    history = history.filter(item => item !== cityName);
    
    // 添加到开头
    history.unshift(cityName);
    
    // 保持最多5条记录
    if (history.length > MAX_HISTORY) {
      history = history.slice(0, MAX_HISTORY);
    }
    
    // 保存到本地存储
    wx.setStorageSync(HISTORY_KEY, history);
    
    // 更新页面数据
    this.setData({
      historyList: history
    });
  },

  clearHistory() {
    wx.showModal({
      title: '提示',
      content: '确定要清除所有历史记录吗？',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync(HISTORY_KEY);
          this.setData({
            historyList: []
          });
        }
      }
    });
  },

  onHistoryItemTap(e) {
    const cityName = e.currentTarget.dataset.city;
    this.setData({
      cityName
    }, () => {
      this.searchWeather();
    });
  },

  onInputChange(e) {
    this.setData({
      cityName: e.detail.value
    });
  },

  getTempTips(temp) {
    const tempNum = parseFloat(temp);
    if (tempNum >= 30) {
      return {
        icon: 'sun',
        text: '温度较高，请注意防晒，多补充水分！',
        class: 'high-temp'
      };
    } else if (tempNum <= 5) {
      return {
        icon: 'cold',
        text: '温度较低，请注意保暖，添加衣物！',
        class: 'low-temp'
      };
    }
    return null;
  },

  /**
   * 带重试机制的网络请求
   * @param {string} url - 请求URL
   * @param {number} retryCount - 当前重试次数
   * @returns {Promise} 请求结果
   */
  async requestWithRetry(url, retryCount = 0) {
    try {
      const result = await this.requestPromise(url);
      // 检查API返回的状态码
      if (result.data.code !== '200') {
        throw new Error(`API错误: ${result.data.code}`);
      }
      return result;
    } catch (error) {
      if (retryCount < MAX_RETRIES) {
        // 等待一定时间后重试
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        console.log(`请求失败，第 ${retryCount + 1} 次重试...`);
        return this.requestWithRetry(url, retryCount + 1);
      }
      throw error;
    }
  },

  requestPromise(url) {
    return new Promise((resolve, reject) => {
      wx.request({
        url,
        success: (res) => {
          if (res.statusCode === 200) {
            resolve(res);
          } else {
            reject(new Error(`HTTP错误: ${res.statusCode}`));
          }
        },
        fail: (error) => {
          reject(new Error(`网络请求失败: ${error.errMsg}`));
        }
      });
    });
  },

  async searchWeather() {
    if (!this.data.cityName) {
      wx.showToast({
        title: '请输入城市名称',
        icon: 'none'
      });
      return;
    }

    // 防止重复请求
    if (this.data.isRequesting) {
      return;
    }

    this.setData({ isRequesting: true });
    wx.showLoading({
      title: '加载中...'
    });

    try {
      // 1. 先获取城市ID
      const cityUrl = `https://geoapi.qweather.com/v2/city/lookup?location=${this.data.cityName}&key=${WEATHER_API_KEY}`;
      const cityRes = await this.requestWithRetry(cityUrl);
      
      if (!cityRes.data.location || cityRes.data.location.length === 0) {
        throw new Error('未找到该城市');
      }
      const cityData = cityRes.data.location[0];

      // 2. 获取实时天气
      const weatherUrl = `https://devapi.qweather.com/v7/weather/now?location=${cityData.id}&key=${WEATHER_API_KEY}`;
      const weatherRes = await this.requestWithRetry(weatherUrl);
      const weatherNow = weatherRes.data.now;

      // 3. 获取空气质量
      const airUrl = `https://devapi.qweather.com/v7/air/now?location=${cityData.id}&key=${WEATHER_API_KEY}`;
      const airRes = await this.requestWithRetry(airUrl);
      const airNow = airRes.data.now;

      // 4. 获取温度提示
      const tempTips = this.getTempTips(weatherNow.temp);

      // 5. 保存到历史记录
      this.saveHistory(cityData.name);

      this.setData({
        weatherData: {
          cityName: cityData.name,
          temp: weatherNow.temp,
          text: weatherNow.text,
          iconUrl: `https://qweather.com/img/icons/${weatherNow.icon}.png`,
          aqi: airNow.aqi,
          aqiLevel: this.getAqiLevel(airNow.aqi),
          tempTips: tempTips
        }
      });
    } catch (error) {
      let errorMsg = '获取天气信息失败';
      
      // 根据错误类型显示不同的错误提示
      if (error.message === '未找到该城市') {
        errorMsg = '未找到该城市，请检查城市名称';
      } else if (error.message.includes('API错误')) {
        errorMsg = '天气服务暂时不可用，请稍后重试';
      } else if (error.message.includes('网络请求失败')) {
        errorMsg = '网络连接失败，请检查网络设置';
      }

      wx.showModal({
        title: '错误提示',
        content: errorMsg,
        showCancel: false
      });
    } finally {
      wx.hideLoading();
      this.setData({ isRequesting: false });
    }
  },

  getAqiLevel(aqi) {
    const aqiNum = parseInt(aqi);
    if (aqiNum <= 50) return '优';
    if (aqiNum <= 100) return '良';
    if (aqiNum <= 150) return '轻度污染';
    if (aqiNum <= 200) return '中度污染';
    if (aqiNum <= 300) return '重度污染';
    return '严重污染';
  }
});
