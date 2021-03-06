import NotifierHandler from '@/ts/classes/NotificationHandler';
import loggerFactory from '@/ts/instances/loggerFactory';
import { Logger } from 'lines-logger';
import {MainWindow} from '@/ts/classes/MainWindow';


export class AudioPlayer {
  private readonly mainWindow: MainWindow;
  private readonly logger: Logger;

  constructor(mainWindow: MainWindow) {
    this.mainWindow = mainWindow;
    this.logger = loggerFactory.getLogger('audio');
  }

  checkAndPlay(element: HTMLAudioElement, volume: number) {
    if (volume && this.mainWindow.isTabMain()) {
      try {
        element.pause();
        element.currentTime = 0;
        element.volume = volume * volume / 10_000;
        const prom = element.play();
        prom && prom.catch(function (e) {
        });
      } catch (e) {
        this.logger.error('Skipping playing message, because {}', e)();
      }
    }
  }
}


