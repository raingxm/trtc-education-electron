import {
  TRTCDeviceInfo,
  TRTCAudioQuality,
  TRTCScreenCaptureSourceInfo,
  Rect,
  TRTCScreenCaptureSourceType,
  TRTCVideoEncParam,
  TRTCVideoQosPreference,
  TRTCBeautyStyle,
  TRTCVideoStreamType,
  TRTCDeviceType,
  TRTCDeviceState,
} from 'trtc-electron-sdk/liteav/trtc_define';
// @ts-ignore
import TIM from 'tim-js-sdk';
import logger from '../../utils/logger';
import Event from '../common/emitter/event';
import { safelyParseJSON, simpleClone } from './util';
import { ETUISpeechMode, ETUIStreamType, ETUIRoomEvents } from './types.d';
import { TUIRoomErrorCode, TUIRoomErrorMessage } from './constant';
import TUIRoomUser from './base/TUIRoomUser';
import TUIRoomError from './base/TUIRoomError';
import TUIRoomResponse from './base/TUIRoomResponse';
import TUIRoomInfo from './base/TUIRoomInfo';
import TRTCService from './TRTCService';
import TIMService from './TIMService';
import ITUIRoomCore from './ITUIRoomCore';
import ITUIRoomCoordinator from './ITUIRoomCoordinator';
import TUIRoomCoordinator from './TUIRoomCoordinator';
import StateStore from './StateStore';
import TUIRoomLifecycle from './TUIRoomLifecycle';
import TUIRoomAuth from './TUIRoomAuth';
import TSignalingService from './TSignalingService';

class TUIRoomCore implements ITUIRoomCore, ITUIRoomCoordinator {
  static logPrefix = '[TUIRoomCore]';

  private static instance: TUIRoomCore | null;

  private state: StateStore;

  private trtcService: TRTCService;

  public timService: TIMService;

  private tsignalingService: TSignalingService;

  private roomCoordinator: TUIRoomCoordinator;

  private SDKAppID = 0;

  private userSig = '';

  private isLogin = false;

  public emitter = new Event();

  private tim: any;

  private roomLifecycle: TUIRoomLifecycle;

  private roomAuth: TUIRoomAuth;

  /**
   * 获取单例实例
   */
  public static getInstance(): TUIRoomCore {
    if (!TUIRoomCore.instance) {
      TUIRoomCore.instance = new TUIRoomCore();
    }
    return TUIRoomCore.instance;
  }

  /**
   * 销毁单例实例
   */
  public static destroyInstance() {
    if (TUIRoomCore.instance !== null) {
      TUIRoomCore.instance.destroy();
    }
  }

  private constructor() {
    this.state = new StateStore();
    this.trtcService = new TRTCService();
    this.timService = new TIMService();
    this.tsignalingService = new TSignalingService();
    this.roomAuth = new TUIRoomAuth(
      this.state,
      this.tsignalingService,
      this.trtcService
    );
    this.roomLifecycle = new TUIRoomLifecycle(
      this.state,
      this.timService,
      this.trtcService
    );
    this.roomCoordinator = new TUIRoomCoordinator(
      this.state,
      this.tsignalingService
    );

    this.onRemoteUserEnterRoom = this.onRemoteUserEnterRoom.bind(this);
    this.onRemoteUserLeaveRoom = this.onRemoteUserLeaveRoom.bind(this);
    this.onUserVideoAvailable = this.onUserVideoAvailable.bind(this);
    this.onUserSubStreamAvailable = this.onUserSubStreamAvailable.bind(this);
    this.onUserAudioAvailable = this.onUserAudioAvailable.bind(this);
    this.onFirstVideoAvailable = this.onFirstVideoAvailable.bind(this);
    this.onTestMicVolume = this.onTestMicVolume.bind(this);
    this.onTestSpeaker = this.onTestSpeaker.bind(this);
    this.bindTRTCEvent();

    this.onReceiveChatMessage = this.onReceiveChatMessage.bind(this);
    this.onReceiveCustomMessage = this.onReceiveCustomMessage.bind(this);
    this.onRoomDestroyed = this.onRoomDestroyed.bind(this);
    this.bindIMEvent();

    this.onCallingRollStarted = this.onCallingRollStarted.bind(this);
    this.onCallingRollStopped = this.onCallingRollStopped.bind(this);
    this.onUserReplyCallingRoll = this.onUserReplyCallingRoll.bind(this);
    this.onMicrophoneMuted = this.onMicrophoneMuted.bind(this);
    this.onReceiveSpeechInvitation = this.onReceiveSpeechInvitation.bind(this);
    this.onReceiveInvitationCancelled =
      this.onReceiveInvitationCancelled.bind(this);
    this.onReceiveInvitationTimeout =
      this.onReceiveInvitationTimeout.bind(this);
    this.onReceiveSpeechApplication =
      this.onReceiveSpeechApplication.bind(this);
    this.onSpeechApplicationTimeout =
      this.onSpeechApplicationTimeout.bind(this);
    this.bindCoordinatorEvent();
  }

  /**
   * /////////////////////////////////////////////////////////////////////////////////
   * //
   * //                                   内部工具、校验方法
   * //
   * /////////////////////////////////////////////////////////////////////////////////
   */
  private checkLogin() {
    if (!this.login) {
      throw new TUIRoomError(
        TUIRoomErrorCode.NOT_LOGIN,
        TUIRoomErrorMessage.NOT_LOGIN
      );
    }
  }

  /**
   * /////////////////////////////////////////////////////////////////////////////////
   * //
   * //                                   登录、登出接口
   * //
   * /////////////////////////////////////////////////////////////////////////////////
   */
  /**
   * 登录
   *
   * 主要是登录 TIM
   *
   * @param {number} SDKAppID - SDKAppID
   * @param {string} userID - 用户ID
   * @param {string} userSig - 用户签名
   * @returns {Promise}
   */
  async login(
    SDKAppID: number,
    userID: string,
    userSig: string
  ): Promise<TUIRoomResponse<any>> {
    logger.log(`${TUIRoomCore.logPrefix}.login`, SDKAppID, userID, userSig);
    if (!this.tim) {
      this.tim = TIM.create({ SDKAppID });
    }
    /**
     * TIM 与 TSignaling 一起使用时，需要通过 TSignaling 登录。
     *
     * 这里新建 TIM 实例后，传给 TIMService 和 TSignalingService 模块，供其内部使用；
     * TUIRoomAuth 向上层 TUIRoomCore 提供认证服务（登录、登出功能），向下依赖于
     * TSignalingService 实现登录、登出。
     */
    this.timService.init({ SDKAppID, userID, userSig, tim: this.tim });
    this.tsignalingService.init({ SDKAppID, userID, userSig, tim: this.tim });
    await this.roomAuth.login(userID, userSig);

    this.SDKAppID = SDKAppID;
    this.userSig = userSig;
    this.isLogin = true; // 同时 SDK is ready
    return TUIRoomResponse.success();
  }

  /**
   * 退出登录
   * @returns {Promise}
   */
  async logout(): Promise<TUIRoomResponse<null>> {
    logger.debug(`${TUIRoomCore.logPrefix}logout`, this.state.currentUser.ID);
    if (this.isLogin) {
      await this.roomAuth.logout();
      this.isLogin = false;
    }
    return TUIRoomResponse.success();
  }

  /**
   * /////////////////////////////////////////////////////////////////////////////////
   * //
   * //                                   房间生命周期管理接口
   * //
   * /////////////////////////////////////////////////////////////////////////////////
   */

  /**
   * 设置房间的初始化配置
   * @param config - 初始化配置
   */
  async setRoomConfig(config: {
    speechMode?: ETUISpeechMode;
    isChatRoomMuted?: boolean;
    isSpeechApplicationForbidden?: boolean;
    isAllCameraMuted?: boolean;
    isAllMicMuted?: boolean;
    isCallingRoll?: boolean;
    startTime?: number;
  }) {
    this.state.roomInfo.roomConfig = Object.assign(
      this.state.roomInfo.roomConfig,
      {
        ...config,
      }
    );
    return this.roomCoordinator.setControlConfig(
      this.state.roomInfo.roomConfig
    );
  }

  /**
   * 检查房间是否存在
   * @param roomID - 房间ID
   * @returns {Promise} - 返回 true 说明存在，返回 false 说明不存在
   */
  async checkRoomExistence(
    roomID: string
  ): Promise<TUIRoomResponse<TUIRoomInfo | null>> {
    logger.log(`${TUIRoomCore.logPrefix}checkRoomExistence roomID: ${roomID}`);
    this.checkLogin();
    const tuiResponse = await this.timService.checkGroupExistence(roomID);
    const { data: groupInfo } = tuiResponse;
    if (groupInfo) {
      const roomInfo = new TUIRoomInfo();
      roomInfo.roomID = roomID;
      roomInfo.ownerID = groupInfo.ownerID;
      if (groupInfo.notification) {
        roomInfo.roomConfig = {
          ...roomInfo.roomConfig,
          ...safelyParseJSON(groupInfo.notification),
        };
      }
      return TUIRoomResponse.success(roomInfo);
    }
    return TUIRoomResponse.success(null);
  }

  /**
   * 创建房间
   *
   * 内部需要同时实现 TIM 建群和 TRTC 进房。
   * 如果 TIM 群已存在，且当前用户是群主，则加入群组；
   * 如果群组已存在，当前用户不是群主，提示房间号已被占用。
   * @param {string} roomID 房间号
   * @param {ETUISpeechMode} mode 发言模式，默认为“申请发言”模式
   * @returns {Promise}
   */
  async createRoom(
    roomID: string,
    mode = ETUISpeechMode.APPLY_SPEECH
  ): Promise<TUIRoomResponse<any>> {
    logger.log(`${TUIRoomCore.logPrefix}createRoom`, roomID, mode);
    this.checkLogin();
    const tuiResponse = await this.roomLifecycle.createRoom({
      SDKAppID: this.SDKAppID,
      userID: this.state.currentUser.ID,
      userSig: this.userSig,
      roomID,
      mode,
    });

    // 初始化 Room Coordinator
    this.roomCoordinator.init({ roomID, tim: this.tim });

    const { room, user } = tuiResponse.data;
    this.emitter.emit(ETUIRoomEvents.onUserEnterRoom, user);
    return TUIRoomResponse.success(room);
  }

  /**
   * 销毁房间
   *
   * 主持人销毁房间，内部需要同时实现 TIM 解散群和 TRTC 退房。观众端会收到房间销毁事件通知 onRoomDestroyed.
   * 需要先退出 TRTC 房间，再解散 TIM 群组。
   * @returns {Promise}
   */
  async destroyRoom(): Promise<TUIRoomResponse<any>> {
    logger.debug(`${TUIRoomCore}destroyRoom`);
    this.checkLogin();
    const tuiResponse = await this.roomLifecycle.destroyRoom();
    const { user } = tuiResponse.data;
    this.emitter.emit(ETUIRoomEvents.onUserLeaveRoom, user);
    return TUIRoomResponse.success();
  }

  /**
   * 进入房间
   *
   * 先加入 TIM 群组，再进入 TRTC 房间
   *
   * @param {string} roomID 房间号
   * @returns {Promise}
   */
  async enterRoom(roomID: string): Promise<TUIRoomResponse<any>> {
    logger.debug(`${TUIRoomCore.logPrefix}enterRoom roomID: ${roomID}`);
    this.checkLogin();

    const tuiResponse = await this.roomLifecycle.enterRoom({
      SDKAppID: this.SDKAppID,
      userID: this.state.currentUser.ID,
      userSig: this.userSig,
      roomID,
    });

    // 初始化 Room Coordinator
    this.roomCoordinator.init({ roomID, tim: this.tim });

    const { room, user } = tuiResponse.data;
    this.emitter.emit(ETUIRoomEvents.onUserEnterRoom, user);
    return TUIRoomResponse.success(room);
  }

  /**
   * 离开房间
   *
   * 先退出 TRTC 房间，再退出 TIM 群
   * @returns {Promise}
   */
  async exitRoom(): Promise<TUIRoomResponse<any>> {
    logger.debug(`${TUIRoomCore.logPrefix}exitRoom`);
    this.checkLogin();
    const tuiResponse = await this.roomLifecycle.exitRoom();
    const { user } = tuiResponse.data;
    this.emitter.emit(ETUIRoomEvents.onUserLeaveRoom, user);
    return TUIRoomResponse.success();
  }

  /**
   * 获取房间信息
   *
   * @returns {TTUIRoomInfo}
   */
  getRoomInfo(): TUIRoomInfo {
    // 克隆一份数据
    return simpleClone(this.state.roomInfo);
  }

  /**
   * 获取所有成员信息
   *
   * @returns {Array<TUIRoomUser>}
   */
  getRoomUsers(): Array<TUIRoomUser> {
    const users: Array<TUIRoomUser> = [];
    this.state.userMap.forEach((value) => {
      users.push(simpleClone(value) as TUIRoomUser);
    });
    return users;
  }

  /**
   * 获取指定用户信息
   *
   * @param {string} userID 成员ID
   * @returns {TUIRoomUser | null}
   */
  getUserInfo(userID: string): TUIRoomUser | null {
    if (this.state.userMap.has(userID)) {
      const user = this.state.userMap.get(userID) as TUIRoomUser;
      return simpleClone(user);
    }
    return null;
  }

  /**
   * 设置用户名和头像
   *
   * @param {string} name 用户名
   * @param {string} avatarURL 头像地址
   */
  setSelfProfile(name: string, avatarURL: string) {
    this.state.currentUser.name = name;
    this.state.currentUser.avatar = avatarURL;
  }

  /**
   * 将房间转交给其他成员
   *
   * @param {string} userID 主持人将房间控制权转交给其他成员
   * @returns {Promise}
   */
  async transferRoomMaster(userID: string): Promise<TUIRoomResponse<any>> {
    logger.debug(
      `${TUIRoomCore.logPrefix}transferRoomMaster userID: ${userID}`,
      this
    );
    return TUIRoomResponse.success();
  }

  /**
   * /////////////////////////////////////////////////////////////////////////////////
   * //
   * //                                   TRTC 相关接口
   * //
   * /////////////////////////////////////////////////////////////////////////////////
   */
  /**
   * 打开本地摄像头
   *
   * @param {HTMLElement} view 显示本地摄像头的 div 元素
   */
  startCameraPreview(view: HTMLElement) {
    logger.debug(`${TUIRoomCore.logPrefix}startCameraPreview`);
    this.trtcService.startCameraPreview(view);
    this.state.currentUser.isVideoStreamAvailable = true;
    this.emitter.emit(ETUIRoomEvents.onUserVideoAvailable, {
      userID: this.state.currentUser.ID,
      available: 1,
      streamType: ETUIStreamType.CAMERA,
    });
    this.emitter.emit(
      ETUIRoomEvents.onUserStateChange,
      simpleClone(this.state.currentUser)
    );
  }

  /**
   * 关闭本地摄像头
   */
  stopCameraPreview() {
    logger.debug(`${TUIRoomCore.logPrefix}stopCameraPreview`);
    this.trtcService.stopCameraPreview();
    this.state.currentUser.isVideoStreamAvailable = false;
    this.emitter.emit(ETUIRoomEvents.onUserVideoAvailable, {
      userID: this.state.currentUser.ID,
      available: 0,
      streamType: ETUIStreamType.CAMERA,
    });
    this.emitter.emit(
      ETUIRoomEvents.onUserStateChange,
      simpleClone(this.state.currentUser)
    );
  }

  /**
   * 打开本地摄像头测试
   *
   * @param {HTMLElement} view 显示本地摄像头的 div 元素
   */
  startCameraDeviceTest(view: HTMLElement) {
    logger.debug(`${TUIRoomCore.logPrefix}startCameraDeviceTest`);
    this.trtcService.startCameraDeviceTest(view);
  }

  /**
   * 关闭本地摄像头测试
   */
  stopCameraDeviceTest() {
    logger.debug(`${TUIRoomCore.logPrefix}stopCameraDeviceTest`);
    this.trtcService.stopCameraDeviceTest();
  }

  /**
   * 开启本地麦克风
   *
   * @param {TRTCAudioQuality} quality 音频采集质量
   */
  startMicrophone(quality?: TRTCAudioQuality) {
    logger.debug(`${TUIRoomCore.logPrefix}startMicrophone`);
    this.trtcService.startMicrophone(quality);
    this.state.currentUser.isAudioStreamAvailable = true;
    this.emitter.emit(ETUIRoomEvents.onUserAudioAvailable, {
      userID: this.state.currentUser.ID,
      available: 1,
    });
    this.emitter.emit(
      ETUIRoomEvents.onUserStateChange,
      simpleClone(this.state.currentUser)
    );
  }

  /**
   * 关闭本地麦克风
   */
  stopMicrophone() {
    logger.debug(`${TUIRoomCore.logPrefix}stopMicrophone`);
    this.trtcService.stopMicrophone();
    this.state.currentUser.isAudioStreamAvailable = false;
    this.emitter.emit(ETUIRoomEvents.onUserAudioAvailable, {
      userID: this.state.currentUser.ID,
      available: 0,
    });
    this.emitter.emit(
      ETUIRoomEvents.onUserStateChange,
      simpleClone(this.state.currentUser)
    );
  }

  /**
   * 开始进行麦克风测试
   *
   */
  startMicrophoneTest() {
    logger.debug(`${TUIRoomCore.logPrefix}startMicrophoneTest`);
    this.trtcService.startMicrophoneTest(200);
  }

  /**
   * 停止麦克风测试
   *
   */
  stopMicrophoneTest() {
    logger.debug(`${TUIRoomCore.logPrefix}stopMicDeviceTest`);
    this.trtcService.stopMicrophoneTest();
  }

  /**
   * 开始进行扬声器测试
   *@param testAudioFilePath 音频文件的绝对路径，路径字符串使用 UTF-8 编码格式，支持文件格式：WAV、MP3
   */
  startSpeakerTest(testAudioFilePath: string) {
    this.trtcService.startSpeakerTest(testAudioFilePath);
  }

  /**
   *  停止扬声器测试
   */
  stopSpeakerTest() {
    this.trtcService.stopSpeakerTest();
  }

  /**
   * 开启系统声音的采集
   *
   * 调用该接口后会开启系统声音采集。
   * 屏幕分享或者开始背景音乐时，建议调用该接口，开启系统声音采集，否则远端听到的声音容易卡顿、延迟。
   */
  startSystemAudioLoopback() {
    this.trtcService.startSystemAudioLoopback();
  }

  /**
   * 关闭系统声音的采集
   * 调用该接口后会关闭系统声音采集。
   */
  stopSystemAudioLoopback() {
    this.trtcService.stopSystemAudioLoopback();
  }

  /**
   * 镜像设置：该设置视频是否进行镜像翻转
   *
   * @param mirror   true开启镜像, false 关闭镜像。
   */
  setVideoMirror(mirror: boolean) {
    this.trtcService.setVideoMirror(mirror);
  }

  /**
   * 静默或取消静默本地摄像头
   */
  muteLocalCamera(mute: boolean) {
    logger.debug(`${TUIRoomCore.logPrefix}muteLocalCamera`);
    this.trtcService.muteLocalCamera(mute);
    this.state.currentUser.isVideoStreamAvailable = !mute;
    this.emitter.emit(ETUIRoomEvents.onUserVideoAvailable, {
      userID: this.state.currentUser.ID,
      available: mute ? 0 : 1,
      streamType: ETUIStreamType.CAMERA,
    });
    this.emitter.emit(
      ETUIRoomEvents.onUserStateChange,
      simpleClone(this.state.currentUser)
    );
  }

  /**
   * 静默或取消静默本地麦克风
   */
  muteLocalMicrophone(mute: boolean) {
    logger.debug(`${TUIRoomCore.logPrefix}muteLocalMicrophone`);
    this.trtcService.muteLocalMicrophone(mute);
    this.state.currentUser.isAudioStreamAvailable = !mute;
    this.emitter.emit(ETUIRoomEvents.onUserAudioAvailable, {
      userID: this.state.currentUser.ID,
      available: mute ? 0 : 1,
    });
    this.emitter.emit(
      ETUIRoomEvents.onUserStateChange,
      simpleClone(this.state.currentUser)
    );
  }

  /**
   * 拉取远端视频流
   *
   * 根据类型，支持拉取远端主流（摄像头）和辅助（屏幕分享）
   * @param {string} userID 成员ID
   * @param {HTMLDivElement} view 显示远端视频流的 div 元素
   * @param {ETUIStreamType} streamType 视频流类型：摄像头或者屏幕分享
   */
  startRemoteView(
    userID: string,
    view: HTMLDivElement,
    streamType: ETUIStreamType
  ) {
    this.trtcService.startRemoteView(userID, view, streamType);
  }

  /**
   * 停止拉取远端视频流
   *
   * @param {string} userID 成员ID
   * @param {ETUIStreamType} streamType 视频流类型：摄像头或者屏幕分享
   */
  stopRemoteView(userID: string, streamType: ETUIStreamType) {
    this.trtcService.stopRemoteView(userID, streamType);
  }

  /**
   * 静默/取消静默远端摄像头视频流
   *
   * @param {string} userID 成员ID
   * @param {boolean} mute true: 静默，false: 取消静默
   */
  muteRemoteCamera(userID: string, mute: boolean) {
    this.trtcService.muteRemoteCamera(userID, mute);
  }

  /**
   * 静默/取消静默远端麦克风音频流
   *
   * @param {string} userID 成员ID
   * @param {boolean} mute true: 静默，false: 取消静默
   */
  muteRemoteAudio(userID: string, mute: boolean) {
    this.trtcService.muteRemoteAudio(userID, mute);
  }

  /**
   * 启用或关闭音量大小提示
   *
   * 开启此功能后，SDK 会在 onUserVoiceVolume() 中反馈对每一路声音音量大小值的评估。
   * 我们在 Demo 中有一个音量大小的提示条，就是基于这个接口实现的。
   * 如希望打开此功能，请在 startLocalAudio() 之前调用。
   *
   * @param {number} interval - 设置 onUserVoiceVolume 回调的触发间隔，单位为ms，最小间隔为100ms，如果小于等于0则会关闭回调，建议设置为300ms
   */
  enableAudioVolumeEvaluation(interval: number) {
    this.trtcService.enableAudioVolumeEvaluation(interval);
  }

  /**
   * 获取可分享的屏幕和窗口列表
   *
   * @returns {Array<TRTCScreenCaptureSourceInfo>} 屏幕和窗口数据列表
   */
  getScreenCaptureSources(
    thumbWidth: number,
    thumbHeight: number,
    iconWidth: number,
    iconHeight: number
  ): Array<TRTCScreenCaptureSourceInfo> {
    return this.trtcService.getScreenCaptureSources(
      thumbWidth,
      thumbHeight,
      iconWidth,
      iconHeight
    );
  }

  /**
   * 选择要分享的屏幕或窗口
   *
   * 选择要分享的屏幕或窗口和开始屏幕分享可以统一成一个接口吗？
   *
   * @param type
   * @param sourceId
   * @param sourceName
   * @param captureRect
   * @param captureMouse
   * @param highlightWindow
   * @deprecated
   */
  selectScreenCaptureTarget(
    type: TRTCScreenCaptureSourceType,
    sourceId: string,
    sourceName: string,
    captureRect: Rect,
    captureMouse: boolean,
    highlightWindow: boolean
  ) {
    this.trtcService.selectScreenCaptureTarget(
      type,
      sourceId,
      sourceName,
      captureRect,
      captureMouse,
      highlightWindow
    );
  }

  /**
   * 开始屏幕分享
   *
   * @param {HTMLDivElement} view 本地显示屏幕分享内容的 div 元素
   * @param {TRTCVideoEncParam} params TRTC 视频参数，非必填。
   */
  async startScreenCapture(
    view: HTMLDivElement | null,
    params?: TRTCVideoEncParam
  ): Promise<TUIRoomResponse<any>> {
    return this.trtcService.startScreenCapture(view, params);
  }

  /**
   * 暂停屏幕分享
   */
  async pauseScreenCapture(): Promise<TUIRoomResponse<any>> {
    return this.trtcService.pauseScreenCapture();
  }

  /**
   * 恢复屏幕分享
   */
  async resumeScreenCapture(): Promise<TUIRoomResponse<any>> {
    return this.trtcService.resumeScreenCapture();
  }

  /**
   * 结束屏幕分享
   */
  async stopScreenCapture(): Promise<TUIRoomResponse<any>> {
    return this.trtcService.stopScreenCapture();
  }

  /**
   * 启动白板分享（特殊的屏幕分享）
   *
   * 共享白，基于屏幕共享实现。停止、恢复、结束白板分享，重用对应屏幕分享相关接口。
   * @deprecated
   */
  async startWhiteboardCapture(): Promise<TUIRoomResponse<any>> {
    logger.log(`${TUIRoomCore.logPrefix}startWhiteboardCapture this:`, this);
    return TUIRoomResponse.success();
  }

  /**
   * 获取麦克风设备列表
   *
   * @returns {Array<TRTCDeviceInfo>}
   */
  getMicrophoneList(): Array<TRTCDeviceInfo> {
    return this.trtcService.getMicrophoneList();
  }

  /**
   * 获取当前麦克风
   *
   * @returns {TRTCDeviceInfo | null}
   */
  getCurrentMicrophone(): TRTCDeviceInfo | null {
    return this.trtcService.getCurrentMicrophone();
  }

  /**
   * 切换当前麦克风
   *
   * @param {string} deviceID 设备ID
   */
  setCurrentMicrophone(deviceID: string) {
    this.trtcService.setCurrentMicrophone(deviceID);
  }

  /**
   * 获取摄像头设备列表
   *
   * @returns {Array<TRTCDeviceInfo>}
   */
  getCameraList(): Array<TRTCDeviceInfo> {
    return this.trtcService.getCameraList();
  }

  /**
   * 获取当前摄像头
   *
   * @returns {TRTCDeviceInfo | null}
   */
  getCurrentCamera(): TRTCDeviceInfo | null {
    return this.trtcService.getCurrentCamera();
  }

  /**
   * 切换当前摄像头
   *
   * @param {string} deviceID 设备ID
   */
  setCurrentCamera(deviceID: string): void {
    this.trtcService.setCurrentCamera(deviceID);
  }

  /**
   * 获取扬声器设备列表
   *
   * @returns {Array<TRTCDeviceInfo>}
   */
  getSpeakerList(): Array<TRTCDeviceInfo> {
    return this.trtcService.getSpeakerList();
  }

  /**
   * 获取当前扬声器
   *
   * @returns {TRTCDeviceInfo | null}
   */
  getCurrentSpeaker(): TRTCDeviceInfo | null {
    return this.trtcService.getCurrentSpeaker();
  }

  /**
   * 获取系统当前扬声器设备音量
   *
   * @returns {number}
   */
  getCurrentSpeakerVolume(): any {
    return this.trtcService.getCurrentSpeakerVolume();
  }

  /**
   * 切换当前扬声器
   *
   * @param {string} deviceID 设备ID
   */
  setCurrentSpeaker(deviceID: string) {
    this.trtcService.setCurrentSpeaker(deviceID);
  }

  /**
   * 开始云端录制
   */
  async startCloudRecord(): Promise<TUIRoomResponse<any>> {
    logger.debug(`${TUIRoomCore.logPrefix}startCloudRecord`, this);
    return TUIRoomResponse.success();
  }

  /**
   * 结束云端录制
   */
  async stopCloudRecord(): Promise<TUIRoomResponse<any>> {
    logger.debug(`${TUIRoomCore.logPrefix}stopCloudRecord`, this);
    return TUIRoomResponse.success();
  }

  /**
   * 设置美颜、美白、红润效果级别
   *
   * TRTC SDK 内部集成了两套风格不同的磨皮算法，一套我们取名叫“光滑”，适用于美女秀场，效果比较明显。
   * 另一套我们取名“自然”，磨皮算法更多地保留了面部细节，主观感受上会更加自然。
   *
   * @param {TRTCBeautyStyle} style - 美颜风格，光滑或者自然，光滑风格磨皮更加明显，适合娱乐场景。
   * - TRTCBeautyStyleSmooth: 光滑，适用于美女秀场，效果比较明显。
   * - TRTCBeautyStyleNature: 自然，磨皮算法更多地保留了面部细节，主观感受上会更加自然。
   * @param {number} beauty    - 美颜级别，取值范围0 - 9，0表示关闭，1 - 9值越大，效果越明显
   * @param {number} white     - 美白级别，取值范围0 - 9，0表示关闭，1 - 9值越大，效果越明显
   * @param {number} ruddiness - 红润级别，取值范围0 - 9，0表示关闭，1 - 9值越大，效果越明显，该参数 windows 平台暂未生效
   */
  setBeautyStyle(
    style: TRTCBeautyStyle,
    beauty: number,
    white: number,
    ruddiness: number
  ): void {
    logger.debug(
      `${TUIRoomCore.logPrefix}setBeautyStyle:`,
      style,
      beauty,
      white,
      ruddiness,
      this
    );
  }

  /**
   * 设置网络流控相关参数
   * 该设置决定了 TRTC SDK 在各种网络环境下的调控策略（例如弱网下是“保清晰”还是“保流畅”）
   *
   * @param {TRTCVideoQosPreference} preference - 弱网下是“保清晰”还是“保流畅”，默认“保清晰“。
   * - TRTCVideoQosPreferenceSmooth: 弱网下保流畅，在遭遇弱网环境时首先确保声音的流畅和优先发送，画面会变得模糊且会有较多马赛克，但可以保持流畅不卡顿。
   * - TRTCVideoQosPreferenceClear : 弱网下保清晰，在遭遇弱网环境时，画面会尽可能保持清晰，但可能会更容易出现卡顿。
   */
  setVideoQosPreference(preference: TRTCVideoQosPreference) {
    this.trtcService.setVideoQosPreference(preference);
    logger.debug(
      `${TUIRoomCore.logPrefix}setVideoQosPreference preference:`,
      preference,
      this
    );
  }

  /**
   * /////////////////////////////////////////////////////////////////////////////////
   * //
   * //                                    TRTC 事件处理
   * //
   * /////////////////////////////////////////////////////////////////////////////////
   */
  bindTRTCEvent() {
    this.trtcService.on('onRemoteUserEnterRoom', this.onRemoteUserEnterRoom);
    this.trtcService.on('onRemoteUserLeaveRoom', this.onRemoteUserLeaveRoom);
    this.trtcService.on('onUserVideoAvailable', this.onUserVideoAvailable);
    this.trtcService.on('onUserSubStreamAvailable', this.onUserSubStreamAvailable); // eslint-disable-line
    this.trtcService.on('onUserAudioAvailable', this.onUserAudioAvailable);
    this.trtcService.on('onFirstVideoAvailable', this.onFirstVideoAvailable);
    this.trtcService.on('onTestMicVolume', this.onTestMicVolume);
    this.trtcService.on('onTestSpeakerVolume', this.onTestSpeaker);
    this.trtcService.on('onDeviceChange', this.onDeviceChange);
  }

  unbindTRTCEvent() {
    this.trtcService.off('onRemoteUserEnterRoom', this.onRemoteUserEnterRoom);
    this.trtcService.off('onRemoteUserLeaveRoom', this.onRemoteUserLeaveRoom);
    this.trtcService.off('onUserVideoAvailable', this.onUserVideoAvailable);
    this.trtcService.off('onUserSubStreamAvailable', this.onUserSubStreamAvailable); // eslint-disable-line
    this.trtcService.off('onUserAudioAvailable', this.onUserAudioAvailable);
    this.trtcService.off('onFirstVideoAvailable', this.onFirstVideoAvailable);
    this.trtcService.off('onTestMicVolume', this.onTestMicVolume);
    this.trtcService.off('onTestSpeakerVolume', this.onTestSpeaker);
    this.trtcService.off('onDeviceChange', this.onDeviceChange);
  }

  onRemoteUserEnterRoom(userID: string) {
    logger.log(
      `${TUIRoomCore.logPrefix}onRemoteUserEnterRoom userID: ${userID}`
    );
    const newUser = new TUIRoomUser();
    newUser.ID = userID;

    this.state.userMap.set(userID, newUser);
    this.emitter.emit(ETUIRoomEvents.onUserEnterRoom, simpleClone(newUser));
  }

  onRemoteUserLeaveRoom(userID: string, reason: number) {
    logger.log(
      `${TUIRoomCore.logPrefix}onRemoteUserLeaveRoom userID: ${userID} reason: ${reason}`
    );
    if (this.state.userMap.has(userID)) {
      const user = this.state.userMap.get(userID) as TUIRoomUser;
      this.state.userMap.delete(userID);
      this.emitter.emit(ETUIRoomEvents.onUserLeaveRoom, simpleClone(user));
    }
  }

  onUserVideoAvailable(userID: string, available: number) {
    logger.log(
      `${TUIRoomCore.logPrefix}onUserVideoAvailable userID: ${userID} available: ${available}`
    );
    let user = this.state.userMap.get(userID);
    if (user) {
      user.isVideoStreamAvailable = Boolean(available);
      this.emitter.emit(ETUIRoomEvents.onUserStateChange, simpleClone(user));
    } else {
      user = new TUIRoomUser();
      user.ID = userID;
      user.isVideoStreamAvailable = Boolean(available);
      this.state.userMap.set(userID, user);
      this.emitter.emit(ETUIRoomEvents.onUserEnterRoom, simpleClone(user));
    }

    this.emitter.emit(ETUIRoomEvents.onUserVideoAvailable, {
      userID,
      available,
      streamType: ETUIStreamType.CAMERA,
    });
  }

  onUserAudioAvailable(userID: string, available: number) {
    logger.log(
      `${TUIRoomCore.logPrefix}onUserAudioAvailable userID: ${userID} available: ${available}`
    );
    let user = this.state.userMap.get(userID);
    if (user) {
      user.isAudioStreamAvailable = Boolean(available);
      this.emitter.emit(ETUIRoomEvents.onUserStateChange, simpleClone(user));
    } else {
      user = new TUIRoomUser();
      user.ID = userID;
      user.isAudioStreamAvailable = Boolean(available);
      this.state.userMap.set(userID, user);
      this.emitter.emit(ETUIRoomEvents.onUserEnterRoom, simpleClone(user));
    }

    this.emitter.emit(ETUIRoomEvents.onUserAudioAvailable, {
      userID,
      available,
    });
  }

  onUserSubStreamAvailable(userID: string, available: number) {
    logger.log(
      `${TUIRoomCore.logPrefix}onUserSubStreamAvailable userID: ${userID} available: ${available}`
    );
    let user = this.state.userMap.get(userID);
    if (user) {
      user.isScreenStreamAvailable = Boolean(available);
      this.emitter.emit(ETUIRoomEvents.onUserStateChange, simpleClone(user));
    } else {
      user = new TUIRoomUser();
      user.ID = userID;
      user.isScreenStreamAvailable = Boolean(available);
      this.state.userMap.set(userID, user);
      this.emitter.emit(ETUIRoomEvents.onUserEnterRoom, simpleClone(user));
    }

    this.emitter.emit(ETUIRoomEvents.onUserVideoAvailable, {
      userID,
      available,
      streamType: ETUIStreamType.SCREEN,
    });
  }

  onFirstVideoAvailable(
    userID: string,
    streamType: TRTCVideoStreamType,
    width: number,
    height: number
  ) {
    this.emitter.emit(ETUIRoomEvents.onFirstVideoFrame, {
      userID: userID || this.state.currentUser.ID,
      streamType:
        streamType === TRTCVideoStreamType.TRTCVideoStreamTypeBig
          ? ETUIStreamType.CAMERA
          : ETUIStreamType.SCREEN,
      width,
      height,
    });
  }

  onTestMicVolume(volume: number) {
    this.emitter.emit(ETUIRoomEvents.onTestMicVolume, volume);
  }

  onTestSpeaker(volume: number) {
    this.emitter.emit(ETUIRoomEvents.onTestSpeakerVolume, volume);
  }

  onDeviceChange(
    deviceId: string,
    type: TRTCDeviceType,
    state: TRTCDeviceState
  ) {
    this.emitter.emit(ETUIRoomEvents.onDeviceChange, {
      deviceId,
      type,
      state,
    });
  }

  /**
   * /////////////////////////////////////////////////////////////////////////////////
   * //
   * //                                    IM 消息发送相关接口
   * //
   * /////////////////////////////////////////////////////////////////////////////////
   */
  /**
   * 发送文本消息
   *
   * @param {string} text 消息文本内容
   * @returns {Promise}
   */
  sendChatMessage(text: string): Promise<TUIRoomResponse<any>> {
    return this.timService.sendChatMessage(text);
  }

  /**
   * 发送自定义消息
   *
   * @param {string} type - 自定义消息类型
   * @param {string} data - JSON string
   * @returns {Promise}
   */
  sendCustomMessage(type: string, data: string): Promise<TUIRoomResponse<any>> {
    return this.timService.sendCustomMessage(type, data);
  }

  /**
   * /////////////////////////////////////////////////////////////////////////////////
   * //
   * //                                    IM 事件处理
   * //
   * /////////////////////////////////////////////////////////////////////////////////
   */
  private bindIMEvent() {
    this.timService.onRoomEvent(ETUIRoomEvents.onReceiveChatMessage, this.onReceiveChatMessage); // eslint-disable-line
    this.timService.onRoomEvent(ETUIRoomEvents.onReceiveCustomMessage, this.onReceiveCustomMessage); // eslint-disable-line
    this.timService.onRoomEvent(ETUIRoomEvents.onRoomDestroyed, this.onRoomDestroyed); // eslint-disable-line
  }

  private unbindIMEvent() {
    this.timService.offRoomEvent(ETUIRoomEvents.onReceiveChatMessage, this.onReceiveChatMessage); // eslint-disable-line
    this.timService.offRoomEvent(ETUIRoomEvents.onReceiveCustomMessage, this.onReceiveCustomMessage); // eslint-disable-line
    this.timService.offRoomEvent(ETUIRoomEvents.onRoomDestroyed, this.onRoomDestroyed); // eslint-disable-line
  }

  // 处理聊天消息接收事件
  private onReceiveChatMessage(event: Record<string, any>) {
    logger.log(`${TUIRoomCore.logPrefix}onReceiveChatMessage message:`, event);
    const { data: message } = event;
    this.emitter.emit(ETUIRoomEvents.onReceiveChatMessage, message);
  }

  // 处理自定义消息接收事件
  private onReceiveCustomMessage(event: Record<string, any>) {
    logger.log(`${TUIRoomCore.logPrefix}onReceiveChatMessage message:`, event);
    const { data: message } = event;
    this.emitter.emit(ETUIRoomEvents.onReceiveCustomMessage, message);
  }

  // 处理房间销毁（群解散）事件
  private onRoomDestroyed() {
    logger.log(`${TUIRoomCore.logPrefix}onRoomDestroyed`);
    this.emitter.emit(ETUIRoomEvents.onRoomDestroyed, null);
  }

  /**
   * /////////////////////////////////////////////////////////////////////////////////
   * //
   * //                                    互动课堂接口
   * //
   * /////////////////////////////////////////////////////////////////////////////////
   */

  async muteUserMicrophone(
    userID: string,
    mute: boolean
  ): Promise<TUIRoomResponse<any>> {
    return this.roomCoordinator.muteUserMicrophone(userID, mute);
  }

  async muteAllUsersMicrophone(mute: boolean): Promise<TUIRoomResponse<any>> {
    return this.roomCoordinator.muteAllUsersMicrophone(mute);
  }

  async muteUserCamera(
    userID: string,
    mute: boolean
  ): Promise<TUIRoomResponse<any>> {
    return this.roomCoordinator.muteUserCamera(userID, mute);
  }

  async muteAllUsersCamera(mute: boolean): Promise<TUIRoomResponse<any>> {
    return this.roomCoordinator.muteAllUsersCamera(mute);
  }

  async muteChatRoom(mute: boolean): Promise<TUIRoomResponse<any>> {
    return this.roomCoordinator.muteChatRoom(mute);
  }

  async kickOffUser(userID: string): Promise<TUIRoomResponse<any>> {
    return this.roomCoordinator.kickOffUser(userID);
  }

  async startCallingRoll(): Promise<TUIRoomResponse<any>> {
    return this.roomCoordinator.startCallingRoll();
  }

  async stopCallingRoll(): Promise<TUIRoomResponse<any>> {
    return this.roomCoordinator.stopCallingRoll();
  }

  async replyCallingRoll(): Promise<TUIRoomResponse<any>> {
    return this.roomCoordinator.replyCallingRoll();
  }

  async sendSpeechInvitation(userID: string): Promise<TUIRoomResponse<any>> {
    return this.roomCoordinator.sendSpeechInvitation(userID);
  }

  async cancelSpeechInvitation(userID: string): Promise<TUIRoomResponse<any>> {
    return this.roomCoordinator.cancelSpeechInvitation(userID);
  }

  async replySpeechInvitation(agree: boolean): Promise<TUIRoomResponse<any>> {
    return this.roomCoordinator.replySpeechInvitation(agree);
  }

  async sendSpeechApplication(): Promise<TUIRoomResponse<any>> {
    const tuiResponse = await this.roomCoordinator.sendSpeechApplication();
    const { code } = tuiResponse;
    if (code === 0) {
      this.muteLocalMicrophone(false);
    }
    return tuiResponse;
  }

  async cancelSpeechApplication(): Promise<TUIRoomResponse<any>> {
    return this.roomCoordinator.cancelSpeechApplication();
  }

  async replySpeechApplication(
    userID: string,
    agree: boolean
  ): Promise<TUIRoomResponse<any>> {
    return this.roomCoordinator.replySpeechApplication(userID, agree);
  }

  async forbidSpeechApplication(
    forbid: boolean
  ): Promise<TUIRoomResponse<any>> {
    return this.roomCoordinator.forbidSpeechApplication(forbid);
  }

  async sendOffSpeaker(userID: string): Promise<TUIRoomResponse<any>> {
    return this.roomCoordinator.sendOffSpeaker(userID);
  }

  async sendOffAllSpeakers(): Promise<TUIRoomResponse<any>> {
    return this.roomCoordinator.sendOffAllSpeakers();
  }

  async exitSpeechState(): Promise<TUIRoomResponse<any>> {
    return this.roomCoordinator.exitSpeechState();
  }

  /**
   * /////////////////////////////////////////////////////////////////////////////////
   * //
   * //                                    互动课堂事件监听处理
   * //
   * /////////////////////////////////////////////////////////////////////////////////
   */
  private bindCoordinatorEvent() {
    this.roomCoordinator.on(
      ETUIRoomEvents.onCallingRollStarted,
      this.onCallingRollStarted
    );
    this.roomCoordinator.on(
      ETUIRoomEvents.onCallingRollStopped,
      this.onCallingRollStopped
    );
    this.roomCoordinator.on(
      ETUIRoomEvents.onUserReplyCallingRoll,
      this.onUserReplyCallingRoll
    );
    this.roomCoordinator.on(
      ETUIRoomEvents.onMicrophoneMuted,
      this.onMicrophoneMuted
    );
    this.roomCoordinator.on(
      ETUIRoomEvents.onReceiveSpeechInvitation,
      this.onReceiveSpeechInvitation
    );
    this.roomCoordinator.on(
      ETUIRoomEvents.onReceiveInvitationCancelled,
      this.onReceiveInvitationCancelled
    );
    this.roomCoordinator.on(
      ETUIRoomEvents.onReceiveInvitationTimeout,
      this.onReceiveInvitationTimeout
    );
    this.roomCoordinator.on(
      ETUIRoomEvents.onReceiveSpeechApplication,
      this.onReceiveSpeechApplication
    );
    this.roomCoordinator.on(
      ETUIRoomEvents.onSpeechApplicationTimeout,
      this.onSpeechApplicationTimeout
    );
  }

  private unbindCoordinatorEvent() {
    this.roomCoordinator.off(
      ETUIRoomEvents.onCallingRollStarted,
      this.onCallingRollStarted
    );
    this.roomCoordinator.off(
      ETUIRoomEvents.onCallingRollStopped,
      this.onCallingRollStopped
    );
    this.roomCoordinator.off(
      ETUIRoomEvents.onUserReplyCallingRoll,
      this.onUserReplyCallingRoll
    );
    this.roomCoordinator.off(
      ETUIRoomEvents.onMicrophoneMuted,
      this.onMicrophoneMuted
    );
    this.roomCoordinator.off(
      ETUIRoomEvents.onReceiveSpeechInvitation,
      this.onReceiveSpeechInvitation
    );
    this.roomCoordinator.off(
      ETUIRoomEvents.onReceiveInvitationCancelled,
      this.onReceiveInvitationCancelled
    );
    this.roomCoordinator.off(
      ETUIRoomEvents.onReceiveInvitationTimeout,
      this.onReceiveInvitationTimeout
    );
    this.roomCoordinator.off(
      ETUIRoomEvents.onReceiveSpeechApplication,
      this.onReceiveSpeechApplication
    );
    this.roomCoordinator.off(
      ETUIRoomEvents.onSpeechApplicationTimeout,
      this.onSpeechApplicationTimeout
    );
  }

  // 开始点名
  private onCallingRollStarted(event: Record<string, any>) {
    logger.log(`${TUIRoomCore.logPrefix}onCallingRollStarted`, event);
    this.emitter.emit(
      ETUIRoomEvents.onCallingRollStarted,
      simpleClone(event.data)
    );
  }

  // 结束点名
  private onCallingRollStopped(event: Record<string, any>) {
    logger.log(`${TUIRoomCore.logPrefix}onCallingRollStopped`, event);
    this.emitter.emit(
      ETUIRoomEvents.onCallingRollStopped,
      simpleClone(event.data)
    );
  }

  // 学生签到
  private onUserReplyCallingRoll(event: Record<string, any>) {
    logger.log(`${TUIRoomCore.logPrefix}onUserReplyCallingRoll`, event);
    this.emitter.emit(
      ETUIRoomEvents.onUserReplyCallingRoll,
      simpleClone(event.data)
    );
  }

  // 开启/关闭麦克风
  private onMicrophoneMuted(event: Record<string, any>) {
    logger.log(`${TUIRoomCore.logPrefix}onMicrophoneMuted`, event);
    this.muteLocalMicrophone(event.data);
    this.emitter.emit(
      ETUIRoomEvents.onMicrophoneMuted,
      simpleClone(event.data)
    );
  }

  // 被邀请上台
  private onReceiveSpeechInvitation(event: Record<string, any>) {
    logger.log(`${TUIRoomCore.logPrefix}onReceiveSpeechInvitation`, event);
    this.emitter.emit(ETUIRoomEvents.onReceiveSpeechInvitation, event.data);
  }

  // 取消邀请上台
  private onReceiveInvitationCancelled(event: Record<string, any>) {
    logger.log(`${TUIRoomCore.logPrefix}onReceiveInvitationCancelled`, event);
    this.emitter.emit(ETUIRoomEvents.onReceiveInvitationCancelled, event.data);
  }

  // 邀请上台超时
  private onReceiveInvitationTimeout(event: Record<string, any>) {
    logger.log(`${TUIRoomCore.logPrefix}onReceiveInvitationTimeout`, event);
    this.emitter.emit(ETUIRoomEvents.onReceiveInvitationTimeout, event.data);
  }

  // 老师监听到学生举手
  private onReceiveSpeechApplication(event: Record<string, any>) {
    logger.log(`${TUIRoomCore.logPrefix}onReceiveSpeechApplication`, event);
    this.emitter.emit(ETUIRoomEvents.onReceiveSpeechApplication, event.data);
  }

  // 老师响应学生举手申请超时
  private onSpeechApplicationTimeout(event: Record<string, any>) {
    logger.log(`${TUIRoomCore.logPrefix}onSpeechApplicationTimeout`, event);
    this.emitter.emit(ETUIRoomEvents.onSpeechApplicationTimeout, event.data);
  }
  /**
   * /////////////////////////////////////////////////////////////////////////////////
   * //
   * //                                    （对外暴露）事件监听注册接口
   * //
   * /////////////////////////////////////////////////////////////////////////////////
   */

  /**
   * 注册事件监听
   */
  on(
    eventName: string,
    handler: (...args: any) => void,
    ctx?: Record<string, any>
  ) {
    this.emitter.on(eventName, handler, ctx);
  }

  /**
   * 取消事件监听
   */
  off(eventName: string, handler: (...args: any) => void) {
    this.emitter.off(eventName as string, handler);
  }

  /**
   * /////////////////////////////////////////////////////////////////////////////////
   * //
   * //                                    其他接口
   * //
   * /////////////////////////////////////////////////////////////////////////////////
   */

  /**
   * 获取 SDK 版本号
   * @returns {string}
   */
  getSDKVersion() {
    return this.trtcService.getSDKVersion();
  }

  /**
   * 销毁当前 TUIRoomCore 实例对象
   *
   * 如果没有退出登录，先退出登录
   */
  async destroy() {
    logger.log(`${TUIRoomCore.logPrefix}destroy`);
    try {
      if (this.isLogin) {
        await this.logout();
      }
      this.state.reset();

      this.unbindTRTCEvent();
      this.trtcService.destroy();

      this.unbindCoordinatorEvent();
      this.roomCoordinator.destroy();

      this.tsignalingService.destroy();

      this.unbindIMEvent();
      this.timService.destroy();
    } catch (error: any) {
      throw error as TUIRoomError;
    }
  }
}

export default TUIRoomCore;
