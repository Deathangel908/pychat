import {
  createMicrophoneLevelVoice,
  getAverageAudioLevel,
  removeAudioProcesssor
} from '@/ts/utils/audioprocc';
import AbstractPeerConnection from '@/ts/webrtc/AbstractPeerConnection';
import {
  ChangeStreamMessage,
  JsAudioAnalyzer,
  SetCallOpponent,
  SetOpponentAnchor,
  SetOpponentVoice
} from '@/ts/types/types';
import WsHandler from '@/ts/message_handlers/WsHandler';
import { DefaultStore } from '@/ts/classes/DefaultStore';
import {
  ConnectToRemoteMessage,
  DefaultMessage
} from '@/ts/types/messages';

export default abstract class CallPeerConnection extends AbstractPeerConnection {
  private audioProcessor: any;
  // ontrack can be triggered multiple time, so call this in order to prevent updaing store multiple time
  private remoteStream: MediaStream|null = null;

  constructor(
      roomId: number,
      connId: string,
      opponentWsId: string,
      userId: number,
      wsHandler: WsHandler,
      store: DefaultStore
  ) {
    super(roomId, connId, opponentWsId, wsHandler, store);
    const payload:  SetCallOpponent = {
      opponentWsId: this.opponentWsId,
      roomId: this.roomId,
      callInfoModel: {
        connected: false,
        mediaStreamLink: null,
        userId,
        opponentCurrentVoice: 0
      }
    };
    this.store.setCallOpponent(payload);
  }

  public oniceconnectionstatechange() {
    this.logger.log(`iceconnectionstate has been changed to ${this.pc!.iceConnectionState}`)();
    if (this.pc!.iceConnectionState === 'disconnected' ||
        this.pc!.iceConnectionState === 'failed' ||
        this.pc!.iceConnectionState === 'closed') {
      // this.logger.log('disconnecting...')();
      // TODO, nope, if state has been changed to disconnected we should NOT close a connection
      // since on chaning streams connection is also dropping and then goes by the chain "checking" "connected" "completed"
      // at least this is on safari, on chrome it usually doesn't go to disconnected,
      // this.onDestroy('Connection has been lost');
    }
  }

  public createPeerConnection (event: ConnectToRemoteMessage) {
    super.createPeerConnection();

    // onaddstream property has been removed from the specification; you should now use RTCPeerConnection.ontrack to watch for track events instead.
    this.pc!.ontrack = (event: RTCTrackEvent) => {
      if (event.streams.length > 1) {
        throw Error("Unexpected multiple streams. Should be exactly 1 stream and multiple tracks");
      }
      if (event.streams.length === 0) {
        throw Error("Oops, expected tracks to be attached at least to one stream");
      }
      this.logger.log('onaddstream video tracks: {} audio tracks: {}', event.streams[0].getVideoTracks(), event.streams[0].getAudioTracks())();
      if (this.remoteStream !== event.streams[0]) {
        this.remoteStream = event.streams[0]
        const payload: SetOpponentAnchor = {
          anchor: this.remoteStream, // r3d71 search bottom
          opponentWsId: this.opponentWsId,
          roomId: this.roomId
        };
        this.store.setOpponentAnchor(payload);

        if (this.sendRtcDataQueue.length > 0) {
          this.logger.log('Connection accepted, consuming sendRtcDataQueue')();
          const queue = this.sendRtcDataQueue;
          this.sendRtcDataQueue = [];
          queue.forEach(message => this.onsendRtcData(message));
        }
        //
        // if (p) { //firefox video.play doesn't return promise
        //   // chrome returns promise, if it's on mobile devices video sound would be muted
        //   // coz it initialized from network instead of user gesture
        //   p.catch(Utils.clickToPlay(this.dom.remote))
        // }
        this.removeAudioProcessor();
        this.audioProcessor = createMicrophoneLevelVoice(this.remoteStream, this.processAudio.bind(this));
      } else {
        this.logger.log("onaddtrack has been called already for this stream. So skipping this cb")()
      }
    };
    this.logger.log('Sending local stream to remote')();

    this.changeStreams(event?.stream);
  }

  private changeStreams(stream: MediaStream|null) {
    const senders = this.pc!.getSenders();
    for (let sender of senders) {
      this.pc!.removeTrack(sender);
    }
    if (stream) {
      for (const track of stream?.getTracks()) {
        // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addTrack
        // check usage notes, if I don't specify a stream as a second arguments
        // onaddtracks in r3d71 would be w/o a stream and I would need to create a stream and assemble them manually
        this.pc!.addTrack(track, stream);
      }
    }
  }

  public onStreamChanged(payload: ChangeStreamMessage) {
    this.logger.log('onStreamChanged {}', payload)();
    if (this.pc) {
      this.changeStreams(payload.newStream);
      this.createOffer();
    }
  }

  public processAudio (audioProc: JsAudioAnalyzer) {
    return () => {
      const level = getAverageAudioLevel(audioProc); // 256 max
      let clasNu;
      if (level < 0.5) {
        clasNu = 0;
      } else if (level < 5) {
        clasNu = 1;
      } else if (level < 12) {
        clasNu = 2;
      } else if (level < 25) {
        clasNu = 3;
      } else if (level < 50) {
        clasNu = 4;
      } else if (level < 90) {
        clasNu = 5;
      } else if (level < 110) {
        clasNu = 6;
      } else if (level < 140) {
        clasNu = 7;
      } else if (level < 180) {
        clasNu = 8;
      } else {
        clasNu = 9;
      }

      const payload: SetOpponentVoice = {
        voice: clasNu,
        opponentWsId: this.opponentWsId,
        roomId: this.roomId
      };
      this.store.setOpponentVoice(payload);
    };
  }

  public removeAudioProcessor () {
    removeAudioProcesssor(this.audioProcessor);
  }

  public onDestroy(reason?: DefaultMessage|string) {
    this.logger.log('Destroying {}, because', this.constructor.name, reason)();
    this.remoteStream = null;
    this.closePeerConnection();
    this.removeAudioProcessor();
    super.onDestroy();
    const payload:  SetCallOpponent = {
      opponentWsId: this.opponentWsId,
      roomId: this.roomId,
      callInfoModel: null
    };
    this.store.setCallOpponent(payload);
  }

}